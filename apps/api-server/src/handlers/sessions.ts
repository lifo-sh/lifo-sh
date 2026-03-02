/**
 * handlers/sessions.ts — REST CRUD for VM sessions
 *
 * POST   /api/sessions            — create a new VM daemon
 * GET    /api/sessions             — list all sessions
 * GET    /api/sessions/:id         — get a single session
 * POST   /api/sessions/:id/pause   — pause a session (SIGSTOP)
 * POST   /api/sessions/:id/resume  — resume a session (SIGCONT)
 * GET    /api/sessions/:id/logs    — lifecycle event log
 * DELETE /api/sessions/:id         — stop a session
 *
 * Lifecycle event logging
 * ───────────────────────
 * Every state change is recorded by appendEvent() as a newline-delimited JSON
 * line appended to ~/.lifo/sessions/<id>.events:
 *
 *   { "ts": "<ISO 8601>", "message": "<human-readable description>" }
 *
 * Events written:
 *   - "Instance launched — PID <n>, mount <path>[, port <n>]"  (createSession)
 *   - "Instance paused"                                        (pauseSession)
 *   - "Instance resumed"                                       (resumeSession)
 *   - "Instance stopped — uptime <Xh Ym Zs>"                  (stopSession)
 *   - "Error: Failed to pause — <reason>"                      (pauseSession failure)
 *   - "Error: Failed to resume — <reason>"                     (resumeSession failure)
 *
 * The .events file is deleted by deleteSession() when an instance is stopped.
 * getSessionLogs() reads and parses it; if no file exists yet it synthesises
 * a single launch event from the session JSON for backwards compatibility.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listSessions, readSession, deleteSession, SESSIONS_DIR } from 'lifo-sh/session';
import { startDaemon } from 'lifo-sh/daemon';
import { sendJson, readJsonBody } from '../router.js';
import type { ApiRequest } from '../types.js';
import type * as http from 'node:http';

/**
 * Appends a single timestamped lifecycle event to ~/.lifo/sessions/<id>.events.
 * The file is newline-delimited JSON (NDJSON) — one { ts, message } object per line.
 * Failures are silently swallowed; logging is best-effort and must never block the
 * HTTP response or crash the server if the disk is full / the directory is missing.
 */
function appendEvent(id: string, message: string): void {
  const eventsPath = path.join(SESSIONS_DIR, `${id}.events`);
  const line = JSON.stringify({ ts: new Date().toISOString(), message }) + '\n';
  try { fs.appendFileSync(eventsPath, line); } catch { /* best-effort */ }
}

/**
 * Resolve the CLI entry point for daemon spawning.
 * The daemon subprocess needs to run the lifo CLI script (not the API server).
 */
function getCliEntryPath(): string {
  // In a pnpm monorepo, lifo-sh's dist/index.js is the CLI entry point.
  // Resolve from the lifo-sh package.
  try {
    // Try to find the CLI dist relative to the lifo-sh package
    const sessionModulePath = require.resolve('lifo-sh/session');
    const distDir = path.dirname(sessionModulePath);
    const cliEntry = path.join(distDir, 'index.js');
    if (fs.existsSync(cliEntry)) return cliEntry;
  } catch {
    // require.resolve may not work in ESM — try import.meta.resolve
  }

  // Fallback: try both dev (src/handlers/ → 4 levels up) and prod (dist/ → 3 levels up)
  for (const depth of ['../../../..', '../../..']) {
    const candidate = path.join(path.resolve(import.meta.dirname, depth), 'packages/cli/dist/index.js');
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('Could not locate lifo CLI entry point. Build lifo-sh first.');
}

/** POST /api/sessions — create a new VM daemon session. */
export async function createSession(req: ApiRequest, res: http.ServerResponse): Promise<void> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await readJsonBody(req);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  // Determine mount path
  let mountPath: string;
  if (typeof body.mountPath === 'string' && body.mountPath) {
    mountPath = path.resolve(body.mountPath);
    if (!fs.existsSync(mountPath)) {
      sendJson(res, 400, { error: `Mount path does not exist: ${mountPath}` });
      return;
    }
    if (!fs.statSync(mountPath).isDirectory()) {
      sendJson(res, 400, { error: `Mount path is not a directory: ${mountPath}` });
      return;
    }
  } else {
    mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
  }

  const port = typeof body.port === 'number' ? body.port : undefined;
  const logTag = typeof body.logTag === 'string' && body.logTag ? body.logTag : undefined;

  try {
    const cliEntry = getCliEntryPath();
    const id = await startDaemon(mountPath, port, undefined, cliEntry, logTag);
    const session = readSession(id);
    if (!session) {
      sendJson(res, 500, { error: 'Session created but metadata not found' });
      return;
    }
    const portMsg = port ? `, port ${port}` : '';
    appendEvent(id, `Instance launched — PID ${session.pid}, mount ${mountPath}${portMsg}`);
    sendJson(res, 201, { ...session, alive: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // We don't have an id yet if startDaemon threw, so we can't log to a file.
    // The error is returned to the caller via the HTTP response.
    sendJson(res, 500, { error: message });
  }
}

/** GET /api/sessions — list all sessions. */
export function getSessions(_req: ApiRequest, res: http.ServerResponse): void {
  const sessions = listSessions();
  sendJson(res, 200, sessions);
}

/** GET /api/sessions/:id — get a single session. */
export function getSession(req: ApiRequest, res: http.ServerResponse): void {
  const { id } = req.params;
  const session = readSession(id!);
  if (!session) {
    sendJson(res, 404, { error: `Session not found: ${id}` });
    return;
  }

  let alive = false;
  try {
    process.kill(session.pid, 0);
    alive = true;
  } catch {
    // process not running
  }

  sendJson(res, 200, { ...session, alive });
}

/** POST /api/sessions/:id/pause — pause (freeze) a session. */
export function pauseSession(req: ApiRequest, res: http.ServerResponse): void {
  const { id } = req.params;
  const session = readSession(id!);
  if (!session) {
    sendJson(res, 404, { error: `Session not found: ${id}` });
    return;
  }

  try {
    process.kill(session.pid, 0); // check alive
  } catch {
    sendJson(res, 409, { error: `Session ${id} is not running` });
    return;
  }

  try {
    process.kill(session.pid, 'SIGSTOP');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(id!, `Error: Failed to pause — ${message}`);
    sendJson(res, 500, { error: `Failed to pause session: ${message}` });
    return;
  }

  appendEvent(id!, 'Instance paused');
  sendJson(res, 200, { ok: true, id, status: 'paused' });
}

/** POST /api/sessions/:id/resume — resume a paused session. */
export function resumeSession(req: ApiRequest, res: http.ServerResponse): void {
  const { id } = req.params;
  const session = readSession(id!);
  if (!session) {
    sendJson(res, 404, { error: `Session not found: ${id}` });
    return;
  }

  try {
    process.kill(session.pid, 0); // check alive
  } catch {
    sendJson(res, 409, { error: `Session ${id} is not running` });
    return;
  }

  try {
    process.kill(session.pid, 'SIGCONT');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(id!, `Error: Failed to resume — ${message}`);
    sendJson(res, 500, { error: `Failed to resume session: ${message}` });
    return;
  }

  appendEvent(id!, 'Instance resumed');
  sendJson(res, 200, { ok: true, id, status: 'running' });
}

/**
 * GET /api/sessions/:id/logs — return the full session log.
 *
 * Merges two NDJSON files and returns them sorted by timestamp:
 *
 *   ~/.lifo/sessions/<id>.events  — lifecycle events (launch, stop, pause, resume)
 *                                   Each line: { ts, message }
 *
 *   ~/.lifo/sessions/<id>.output  — raw terminal output written by the daemon
 *                                   Each line: { ts, data }
 *                                   Chunks may contain ANSI escape codes; the
 *                                   client is responsible for stripping them.
 *
 * Response shape:
 *   { events: Array<{ ts, type: "lifecycle", message } | { ts, type: "output", data }> }
 *
 * Malformed lines in either file are silently skipped. If both files are empty
 * (instance predates logging), a synthetic launch event is returned for
 * backwards compatibility.
 */
export function getSessionLogs(req: ApiRequest, res: http.ServerResponse): void {
  const { id } = req.params;

  // ?logTag=<projectId> pins the output log to a stable filename that persists
  // across restarts. When provided, <logTag>.output is read instead of <id>.output.
  const qs = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  const logTag = qs.get('logTag') ?? null;

  type LifecycleEvent = { ts: string; type: 'lifecycle'; message: string };
  type OutputEvent    = { ts: string; type: 'output';    data: string };
  type LogEntry = LifecycleEvent | OutputEvent;

  const entries: LogEntry[] = [];

  // Read lifecycle events (.events) — always keyed by session ID.
  const eventsPath = path.join(SESSIONS_DIR, `${id}.events`);
  if (fs.existsSync(eventsPath)) {
    try {
      const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          entries.push({ ts: e.ts, type: 'lifecycle', message: e.message });
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore read errors */ }
  }

  // Read terminal output — keyed by logTag when provided so the output file
  // survives stop/start cycles (new session ID each restart, same logTag file).
  const outputKey = logTag ?? id;
  const outputPath = path.join(SESSIONS_DIR, `${outputKey}.output`);
  if (fs.existsSync(outputPath)) {
    try {
      const lines = fs.readFileSync(outputPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          entries.push({ ts: e.ts, type: 'output', data: e.data });
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore read errors */ }
  }

  // Sort everything by timestamp so lifecycle events interleave with output correctly.
  entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Backwards-compat: synthesise a launch event for instances created before logging.
  if (entries.length === 0) {
    const session = readSession(id!);
    if (session) {
      const portMsg = session.port ? `, port ${session.port}` : '';
      entries.push({
        ts: session.startedAt,
        type: 'lifecycle',
        message: `Instance launched — PID ${session.pid}, mount ${session.mountPath}${portMsg}`,
      });
    }
  }

  sendJson(res, 200, { events: entries });
}

/** DELETE /api/output/:logTag — delete a persistent output log file. */
export function deleteOutputLog(req: ApiRequest, res: http.ServerResponse): void {
  const { logTag } = req.params;
  const filePath = path.join(SESSIONS_DIR, `${logTag}.output`);
  try { fs.unlinkSync(filePath); } catch { /* ok if already gone */ }
  sendJson(res, 200, { ok: true });
}

/** DELETE /api/sessions/:id — stop a session. */
export function stopSession(req: ApiRequest, res: http.ServerResponse): void {
  const { id } = req.params;
  const session = readSession(id!);
  if (!session) {
    sendJson(res, 404, { error: `Session not found: ${id}` });
    return;
  }

  const uptimeMs = Date.now() - new Date(session.startedAt).getTime();
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const uptime = uptimeSec < 60
    ? `${uptimeSec}s`
    : uptimeSec < 3600
      ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
      : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
  appendEvent(id!, `Instance stopped — uptime ${uptime}`);
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {
    // already dead — still clean up files
  }

  deleteSession(id!);

  // Clean up the output log alongside the events log that deleteSession() removes.
  try { fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.output`)); } catch { /* ok if absent */ }

  sendJson(res, 200, { ok: true, id });
}
