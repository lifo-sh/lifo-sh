/**
 * daemon.ts — spawn a lifo VM as a detached background process
 *
 * `startDaemon()` is called by the host CLI (`lifo --detach` / `lifo new`)
 * to boot a new VM without blocking the user's terminal.
 *
 * How it works:
 *   1. Generate a unique session ID.
 *   2. Spawn a new Node.js process running this same script with the
 *      hidden `--daemon` flag. The child is fully detached from the
 *      parent's stdio and process group so it survives terminal close.
 *   3. Poll until the daemon's Unix socket file appears on disk
 *      (the daemon creates it once it's ready to accept connections).
 *   4. Return the session ID to the caller so it can be displayed or
 *      passed straight to attachToSession().
 *
 * Dev vs production:
 *   In production the script is compiled to plain JS and spawned with
 *   `node dist/index.js`. In dev mode the entry point is a TypeScript
 *   file, so we must spawn via `tsx` instead — getSpawnExecutable()
 *   handles this by inspecting the file extension of process.argv[1].
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SESSIONS_DIR } from './session.js';

/** Generates a short random hex ID, e.g. "a1b2c3". */
function generateId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Determines the executable (and any prefix args) needed to re-invoke this
 * script as a child process.
 *
 * - Production (entry = *.js): use `node` directly via process.execPath.
 * - Dev mode  (entry = *.ts): use the `tsx` binary so TypeScript can run.
 *   tsx is looked up in node_modules/.bin relative to the script location,
 *   falling back to the workspace root.
 */
function getSpawnExecutable(): { executable: string; prefixArgs: string[] } {
  const script = process.argv[1]!;
  if (script.endsWith('.ts')) {
    const candidates = [
      // Package-level node_modules (most common in a pnpm monorepo)
      path.resolve(path.dirname(script), '../node_modules/.bin/tsx'),
      // Workspace root node_modules
      path.resolve(path.dirname(script), '../../node_modules/.bin/tsx'),
      // cwd fallback
      path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
    ];
    for (const tsx of candidates) {
      if (fs.existsSync(tsx)) {
        return { executable: tsx, prefixArgs: [] };
      }
    }
    throw new Error(
      'Running in dev mode but could not find tsx binary. ' +
        'Try `pnpm build:cli` and use the compiled output instead.',
    );
  }
  return { executable: process.execPath, prefixArgs: [] };
}

/**
 * Boots a new lifo VM in the background and returns its session ID.
 *
 * @param mountPath  Absolute path on the host to mount at /mnt/host inside
 *                   the VM. Must already exist.
 * @returns          The session ID (hex string) once the daemon is ready.
 * @throws           If the daemon fails to become ready within 5 seconds.
 */
export async function startDaemon(mountPath: string): Promise<string> {
  const id = generateId();
  const socketPath = path.join(SESSIONS_DIR, `${id}.sock`);

  const { executable, prefixArgs } = getSpawnExecutable();

  // Spawn the daemon detached with all stdio ignored so the parent can exit
  // freely without the child being affected.
  const child = cp.spawn(
    executable,
    [...prefixArgs, process.argv[1]!, '--daemon', '--id', id, '--mount', mountPath],
    {
      detached: true,
      stdio: 'ignore',   // daemon has no terminal
      env: { ...process.env },
    },
  );

  // Detach the parent's reference so Node won't wait for this child to exit.
  child.unref();

  // The daemon creates its socket file once it's listening and ready.
  // Poll for up to 5 seconds before giving up.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) break;
    await new Promise(r => setTimeout(r, 100));
  }

  if (!fs.existsSync(socketPath)) {
    throw new Error(`Daemon failed to start (socket never appeared at ${socketPath})`);
  }

  return id;
}
