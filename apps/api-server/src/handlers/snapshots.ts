/**
 * handlers/snapshots.ts — snapshot save / list / restore / download / delete
 *
 * Snapshots capture the full in-memory state of a running VM instance (VFS tree,
 * working directory, and environment variables) into a portable zip file stored at
 * ~/.lifo/snapshots/<sessionId>-<timestamp>.zip on the host.
 *
 * How saving works:
 *   1. The API server connects to the daemon's Unix socket (~/.lifo/sessions/<id>.sock).
 *   2. It sends { type: "snapshot" } over the socket.
 *   3. The daemon serializes its VFS and replies with { type: "snapshot-data", vfs, cwd, env }.
 *   4. The API server writes the data as a zip containing a single snapshot.json.
 *
 * How restoring works:
 *   1. The zip is read and the VFS/cwd/env are extracted.
 *   2. The data is written to a temp JSON file.
 *   3. startDaemon() is called with --snapshot <tempFile>, which makes the new daemon
 *      boot with the restored VFS state instead of a blank filesystem.
 *   4. The temp file is cleaned up; a brand-new session is returned. The original
 *      instance (if still running) is completely unaffected.
 *
 * Routes:
 *   POST   /api/sessions/:id/snapshot  — capture a snapshot from a running instance
 *   GET    /api/snapshots              — list all saved snapshots with metadata
 *   POST   /api/snapshots/restore      — boot a new instance from a snapshot
 *   GET    /api/snapshots/:filename    — download a snapshot zip file
 *   DELETE /api/snapshots/:filename    — permanently delete a snapshot zip file
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSession } from 'lifo-sh/session';
import { requestSnapshot, writeSnapshotZip, readSnapshotZip, listSnapshots, SNAPSHOTS_DIR } from 'lifo-sh/snapshot';
import { startDaemon } from 'lifo-sh/daemon';
import { sendJson, readJsonBody } from '../router.js';
import type { ApiRequest } from '../types.js';
import type * as http from 'node:http';

/**
 * Resolves the compiled CLI entry point (dist/index.js) so startDaemon() can
 * spawn new daemon processes. Tries two strategies:
 *   1. Resolve via require() relative to the lifo-sh package (works in prod).
 *   2. Walk up to the monorepo root and find packages/cli/dist/index.js (dev).
 */
function getCliEntryPath(): string {
  try {
    const sessionModulePath = require.resolve('lifo-sh/session');
    const distDir = path.dirname(sessionModulePath);
    const cliEntry = path.join(distDir, 'index.js');
    if (fs.existsSync(cliEntry)) return cliEntry;
  } catch {}

  for (const depth of ['../../../..', '../../..']) {
    const candidate = path.join(path.resolve(import.meta.dirname, depth), 'packages/cli/dist/index.js');
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('Could not locate lifo CLI entry point. Build lifo-sh first.');
}

/** POST /api/sessions/:id/snapshot — capture and save a snapshot of a running instance. */
export async function saveSnapshot(req: ApiRequest, res: http.ServerResponse): Promise<void> {
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
    const data = await requestSnapshot(session.socketPath);
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    const filename = `${id}-${Date.now()}.zip`;
    writeSnapshotZip(data, path.join(SNAPSHOTS_DIR, filename));
    sendJson(res, 201, { filename, savedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
}

/** GET /api/snapshots — list all saved snapshot files with metadata. */
export function getSnapshots(_req: ApiRequest, res: http.ServerResponse): void {
  const files = listSnapshots();
  const snapshots = files.map((filePath) => {
    const filename = path.basename(filePath);
    const stat = fs.statSync(filePath);
    // Filename format: <sessionId>-<unixMs>.zip
    const match = filename.match(/^([a-f0-9]+)-(\d+)\.zip$/);
    const sessionId = match?.[1] ?? null;
    const savedAt = match?.[2]
      ? new Date(parseInt(match[2])).toISOString()
      : stat.mtime.toISOString();
    return { filename, sessionId, savedAt, size: stat.size };
  }).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  sendJson(res, 200, { snapshots });
}

/** POST /api/snapshots/restore — boot a new instance from a saved snapshot. */
export async function restoreSnapshot(req: ApiRequest, res: http.ServerResponse): Promise<void> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await readJsonBody(req);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const filename = typeof body.filename === 'string' ? body.filename : null;
  if (!filename) {
    sendJson(res, 400, { error: 'filename is required' });
    return;
  }

  // Prevent path traversal
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.zip')) {
    sendJson(res, 400, { error: 'Invalid filename' });
    return;
  }

  const filePath = path.join(SNAPSHOTS_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: `Snapshot not found: ${safeName}` });
    return;
  }

  let data: Awaited<ReturnType<typeof readSnapshotZip>>;
  try {
    data = readSnapshotZip(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `Failed to read snapshot: ${message}` });
    return;
  }

  // Resolve mount path: explicit body param > original mount path > temp dir
  let mountPath: string;
  const requestedMount = typeof body.mountPath === 'string' ? body.mountPath : null;
  if (requestedMount) {
    if (!fs.existsSync(requestedMount) || !fs.statSync(requestedMount).isDirectory()) {
      sendJson(res, 400, { error: `Mount path does not exist: ${requestedMount}` });
      return;
    }
    mountPath = requestedMount;
  } else if (data.mountPath && fs.existsSync(data.mountPath) && fs.statSync(data.mountPath).isDirectory()) {
    mountPath = data.mountPath;
  } else {
    mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
  }

  // Write snapshot payload to a temp file. The daemon reads this on boot and
  // deletes it itself, but we also attempt cleanup here in case startDaemon throws.
  const tmpSnap = path.join(os.tmpdir(), `lifo-snap-${Date.now()}.json`);
  fs.writeFileSync(tmpSnap, JSON.stringify({ vfs: data.vfs, cwd: data.cwd, env: data.env }), 'utf-8');

  try {
    const cliEntry = getCliEntryPath();
    const id = await startDaemon(mountPath, undefined, tmpSnap, cliEntry);
    try { fs.unlinkSync(tmpSnap); } catch { /* daemon already cleaned it up */ }
    const session = readSession(id);
    if (!session) {
      sendJson(res, 500, { error: 'Instance started but session metadata not found' });
      return;
    }
    sendJson(res, 201, { ...session, alive: true });
  } catch (err: unknown) {
    try { fs.unlinkSync(tmpSnap); } catch {}
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
}

/** GET /api/snapshots/:filename — download a snapshot zip file. */
export function downloadSnapshot(req: ApiRequest, res: http.ServerResponse): void {
  const { filename } = req.params;
  const safeName = path.basename(filename!);
  if (!safeName.endsWith('.zip')) {
    sendJson(res, 400, { error: 'Invalid filename' });
    return;
  }

  const filePath = path.join(SNAPSHOTS_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: `Snapshot not found: ${safeName}` });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      // Content-Length lets the client show download progress.
      'Content-Length': String(stat.size),
    });
    // Stream directly from disk — avoids loading the whole zip into memory.
    fs.createReadStream(filePath).pipe(res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 500, { error: `Failed to read snapshot: ${message}` });
  }
}

/** DELETE /api/snapshots/:filename — remove a snapshot zip file. */
export function deleteSnapshot(req: ApiRequest, res: http.ServerResponse): void {
  const { filename } = req.params;
  const safeName = path.basename(filename!);
  if (!safeName.endsWith('.zip')) {
    sendJson(res, 400, { error: 'Invalid filename' });
    return;
  }

  const filePath = path.join(SNAPSHOTS_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: `Snapshot not found: ${safeName}` });
    return;
  }

  try {
    fs.unlinkSync(filePath);
    sendJson(res, 200, { ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `Failed to delete snapshot: ${message}` });
  }
}
