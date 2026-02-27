/**
 * index.ts — lifo CLI entry point
 *
 * Commands
 * ────────
 *   lifo                          Interactive shell (ephemeral, exits with terminal)
 *   lifo --mount <path>           Interactive shell with host directory mounted at /mnt/host
 *
 *   lifo new [--mount <path>]     Boot a new VM daemon and immediately attach to it.
 *                                 Ctrl+D or `exit` detaches; VM keeps running.
 *
 *   lifo --detach [--mount <path>] Boot a VM daemon in the background, print its ID,
 *                                  return to the host shell immediately.
 *
 *   lifo list                     List all running (and dead) VM sessions.
 *   lifo attach <id>              Wire this terminal to an existing VM.
 *   lifo stop <id>                Send SIGTERM to the daemon and remove session files.
 *
 *   lifo login / logout / whoami  Auth helpers (see auth.ts).
 *
 * Internal flag (not user-facing):
 *   lifo --daemon --id <id> --mount <path>
 *                                 Runs as the background daemon process.
 *                                 Spawned by startDaemon(); should not be called directly.
 *
 * Architecture overview
 * ─────────────────────
 *   Host terminal
 *     └─ lifo new / lifo attach <id>   (attach.ts: attachToSession)
 *          └─ Unix socket ~/.lifo/sessions/<id>.sock
 *               └─ Daemon process (index.ts: runDaemon)
 *                    ├─ DaemonTerminal  (multiplexes socket clients ↔ Shell)
 *                    ├─ Kernel + VFS
 *                    └─ Shell
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Kernel,
  Shell,
  NativeFsProvider,
  createDefaultRegistry,
  bootLifoPackages,
  createLifoPkgCommand,
  createNpmCommand,
  createPsCommand,
  createTopCommand,
  createKillCommand,
  createWatchCommand,
  createHelpCommand,
  createNodeCommand,
  createCurlCommand,
} from '@lifo-sh/core';
import { NodeTerminal } from './NodeTerminal.js';
import { DaemonTerminal } from './DaemonTerminal.js';
import { TOKEN_PATH, readToken, handleLogin, handleLogout, handleWhoami } from './auth.js';
import { SESSIONS_DIR, writeSession, deleteSession, readSession, listSessions } from './session.js';
import { startDaemon } from './daemon.js';
import { attachToSession } from './attach.js';

// ─── CLI argument parsing ──────────────────────────────────────────────────────

/**
 * All recognised user-facing subcommands. Used by getEffectiveArgs() to find
 * where the real user input starts when pnpm dev mode injects extra args.
 */
const SUBCOMMANDS = new Set(['login', 'logout', 'whoami', 'list', 'attach', 'stop', 'new']);

/**
 * Returns the user-facing args, stripping any leading positional args that
 * were injected by the pnpm dev script.
 *
 * Problem: `pnpm dev:cli lifo-sh list` expands to `tsx src/index.ts lifo-sh list`
 * so process.argv[2] is "lifo-sh" (the package name), not the subcommand.
 *
 * Fix: scan forward from argv[2] and skip any args that are neither a known
 * subcommand nor a flag (starts with `-`). The first recognised token onwards
 * is what the user actually typed.
 *
 * In production (`node dist/index.js list`) there are no injected args so
 * the scan finds "list" at position 0 immediately and nothing is stripped.
 */
function getEffectiveArgs(): string[] {
  const args = process.argv.slice(2);
  const start = args.findIndex(a => a.startsWith('-') || SUBCOMMANDS.has(a));
  return start >= 0 ? args.slice(start) : args;
}

interface CliOptions {
  mount?: string;
  detach?: boolean;
  /** Internal flag — marks the process as a background daemon. Not user-facing. */
  daemon?: boolean;
  /** Internal flag — the session ID passed to the daemon by startDaemon(). */
  id?: string;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--mount' || args[i] === '-m') && args[i + 1]) {
      opts.mount = path.resolve(args[i + 1]!);
      i++;
    } else if (args[i] === '--detach' || args[i] === '-d') {
      opts.detach = true;
    } else if (args[i] === '--daemon') {
      opts.daemon = true;
    } else if (args[i] === '--id' && args[i + 1]) {
      opts.id = args[i + 1]!;
      i++;
    }
  }
  return opts;
}

// ─── Subcommand: list ─────────────────────────────────────────────────────────

/** Prints a table of all sessions from ~/.lifo/sessions/, with liveness check. */
function handleList(): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log('No running VMs.');
    return;
  }
  const now = Date.now();
  console.log('ID       UPTIME   MOUNT                              STATUS');
  for (const s of sessions) {
    const uptimeMs = now - new Date(s.startedAt).getTime();
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const uptime =
      uptimeSec < 60
        ? `${uptimeSec}s`
        : uptimeSec < 3600
          ? `${Math.floor(uptimeSec / 60)}m`
          : `${Math.floor(uptimeSec / 3600)}h`;
    const mount = s.mountPath.padEnd(34).slice(0, 34);
    const status = s.alive ? 'running' : 'dead';
    console.log(`${s.id.padEnd(8)} ${uptime.padEnd(8)} ${mount} ${status}`);
  }
}

// ─── Subcommand: stop ─────────────────────────────────────────────────────────

/**
 * Gracefully shuts down a VM by sending SIGTERM to its daemon process,
 * then removes the session files. The daemon's SIGTERM handler closes the
 * socket server and calls process.exit(0).
 */
function handleStop(id: string): void {
  const session = readSession(id);
  if (!session) {
    console.error(`No session found with id: ${id}`);
    process.exit(1);
  }
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {
    // Process may have already died (crash, manual kill, etc.) — that's fine,
    // we still want to clean up the stale session files below.
  }
  deleteSession(id);
  console.log(`Stopped VM ${id}`);
}

// ─── Daemon mode (internal) ───────────────────────────────────────────────────

/**
 * Runs the lifo kernel + shell as a headless background daemon.
 *
 * This function is only ever entered when the process was spawned by
 * startDaemon() with the hidden `--daemon` flag. It should never be called
 * directly by users.
 *
 * Startup sequence:
 *   1. Boot kernel and mount the host directory at /mnt/host.
 *   2. Create a DaemonTerminal (socket-backed ITerminal).
 *   3. Build and start the Shell.
 *   4. Start a Unix socket server and write the session file so the parent
 *      process (and future `lifo attach` calls) can find us.
 *
 * Shutdown:
 *   SIGTERM / SIGHUP → close socket server + delete session files + exit.
 *   `exit` typed in the shell → disconnects all clients, VM keeps running.
 */
async function runDaemon(id: string, mountPath: string): Promise<void> {
  const socketPath = path.join(SESSIONS_DIR, `${id}.sock`);

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  // Remove a stale socket left by a previously crashed daemon with this ID.
  try { fs.unlinkSync(socketPath); } catch { /* ok if it doesn't exist */ }

  const daemonTerminal = new DaemonTerminal();

  // ── Kernel ────────────────────────────────────────────────────────────────
  const kernel = new Kernel();
  await kernel.boot({ persist: false }); // in-memory VFS; state lives in this process

  const MOUNT_PATH = '/mnt/host';
  kernel.vfs.mkdir('/mnt', { recursive: true });
  const nativeProvider = new NativeFsProvider(mountPath, fs);
  kernel.vfs.mount(MOUNT_PATH, nativeProvider);

  // ── Shell ─────────────────────────────────────────────────────────────────
  const registry = createDefaultRegistry();
  bootLifoPackages(kernel.vfs, registry);

  const env = kernel.getDefaultEnv();
  env.PWD = MOUNT_PATH;          // start the shell inside the mounted directory
  env.LIFO_HOST_DIR = mountPath; // expose host path for scripts that need it

  const token = readToken();
  if (token) env.LIFO_AUTH_TOKEN = token;
  env.LIFO_TOKEN_PATH = TOKEN_PATH;

  const shell = new Shell(daemonTerminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps',   createPsCommand(jobTable));
  registry.register('top',  createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  const npmShellExecute = async (
    cmd: string,
    cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } },
  ) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm',  createNpmCommand(registry, npmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, npmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');

  // Override `exit` to detach all clients instead of killing the daemon.
  // This matches Docker's behaviour: exiting an attached session drops you
  // back to the host shell but the container (VM) stays alive.
  // To actually kill the VM, use `lifo stop <id>`.
  (shell as any).builtins.set('exit', async () => {
    daemonTerminal.disconnectAllClients();
    return 0;
  });

  // ── Socket server ─────────────────────────────────────────────────────────
  const motd = kernel.vfs.readFileString('/etc/motd');
  const motdText = motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

  const server = net.createServer((socket) => {
    // Greet each newly attached client with the MOTD and mount info.
    const mountInfo = `\x1b[2mMounted: ${mountPath} -> ${MOUNT_PATH}\x1b[0m\r\n`;
    const welcome = JSON.stringify({ type: 'output', data: motdText + mountInfo }) + '\n';
    socket.write(welcome);
    daemonTerminal.addClient(socket);
  });

  // Start listening BEFORE writing the session file so the parent process
  // (polling for the socket) doesn't see a partially-ready daemon.
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  // Now that the socket is ready, register ourselves in the session registry.
  writeSession({ id, pid: process.pid, socketPath, mountPath, startedAt: new Date().toISOString() });

  shell.start();

  // ── Shutdown handler ──────────────────────────────────────────────────────
  function shutdown() {
    server.close();       // stop accepting new connections
    deleteSession(id);    // clean up ~/.lifo/sessions/<id>.{json,sock}
    process.exit(0);
  }

  process.on('SIGTERM', shutdown); // sent by `lifo stop <id>`
  process.on('SIGHUP',  shutdown); // sent when parent terminal closes
}

// ─── Interactive mode (default) ───────────────────────────────────────────────

/**
 * The original lifo behaviour: boot a kernel+shell attached directly to the
 * current terminal. The session is ephemeral — it dies when the terminal closes.
 * No background daemon, no socket, no session file.
 */
async function runInteractive(opts: CliOptions): Promise<void> {
  const terminal = new NodeTerminal();

  let hostDir: string;
  let isTempSession = false;

  if (opts.mount) {
    if (!fs.existsSync(opts.mount)) {
      console.error(`Error: mount path does not exist: ${opts.mount}`);
      process.exit(1);
    }
    if (!fs.statSync(opts.mount).isDirectory()) {
      console.error(`Error: mount path is not a directory: ${opts.mount}`);
      process.exit(1);
    }
    hostDir = opts.mount;
  } else {
    // No mount path given — create a throwaway temp directory.
    hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
    isTempSession = true;
  }

  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  const MOUNT_PATH = '/mnt/host';
  kernel.vfs.mkdir('/mnt', { recursive: true });
  const nativeProvider = new NativeFsProvider(hostDir, fs);
  kernel.vfs.mount(MOUNT_PATH, nativeProvider);

  const registry = createDefaultRegistry();
  bootLifoPackages(kernel.vfs, registry);

  const env = kernel.getDefaultEnv();
  env.PWD = MOUNT_PATH;
  env.LIFO_HOST_DIR = hostDir;

  const token = readToken();
  if (token) env.LIFO_AUTH_TOKEN = token;
  env.LIFO_TOKEN_PATH = TOKEN_PATH;

  const shell = new Shell(terminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps',   createPsCommand(jobTable));
  registry.register('top',  createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  const npmShellExecute = async (
    cmd: string,
    cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } },
  ) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm',  createNpmCommand(registry, npmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, npmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');

  // In interactive mode `exit` should terminate the process entirely.
  (shell as any).builtins.set('exit', async () => {
    cleanup();
    return 0;
  });

  const motd = kernel.vfs.readFileString('/etc/motd');
  terminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));

  if (isTempSession) {
    terminal.write(`\x1b[2mTemp session: ${hostDir}\x1b[0m\r\n`);
  } else {
    terminal.write(`\x1b[2mMounted: ${hostDir} -> ${MOUNT_PATH}\x1b[0m\r\n`);
  }

  shell.start();

  function cleanup() {
    terminal.destroy();
    if (isTempSession) {
      // Clean up the throwaway temp directory we created above.
      try { fs.rmSync(hostDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    process.exit(0);
  }

  process.on('SIGTERM', cleanup);
  process.on('SIGHUP',  cleanup);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Strip any pnpm-injected package-name arg so dev and prod CLI behave the same.
  const args = getEffectiveArgs();
  const cmd = args[0];

  // ── Auth commands ──────────────────────────────────────────────────────────
  if (cmd === 'login')  { await handleLogin(); return; }
  if (cmd === 'logout') { handleLogout(); return; }
  if (cmd === 'whoami') { await handleWhoami(); return; }

  // ── VM lifecycle commands ──────────────────────────────────────────────────
  if (cmd === 'list') { handleList(); return; }

  if (cmd === 'attach') {
    const id = args[1];
    if (!id) { console.error('Usage: lifo attach <id>'); process.exit(1); }
    await attachToSession(id);
    return;
  }

  if (cmd === 'stop') {
    const id = args[1];
    if (!id) { console.error('Usage: lifo stop <id>'); process.exit(1); }
    handleStop(id);
    return;
  }

  if (cmd === 'new') {
    // Boot a VM daemon and immediately attach to it in one step.
    // Equivalent to: lifo --detach && lifo attach <id>
    const mountArg = args[1] === '--mount' || args[1] === '-m' ? args[2] : undefined;
    let mountPath: string;
    if (mountArg) {
      const resolved = path.resolve(mountArg);
      if (!fs.existsSync(resolved)) {
        console.error(`Error: mount path does not exist: ${resolved}`);
        process.exit(1);
      }
      if (!fs.statSync(resolved).isDirectory()) {
        console.error(`Error: mount path is not a directory: ${resolved}`);
        process.exit(1);
      }
      mountPath = resolved;
    } else {
      mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
    }
    try {
      const id = await startDaemon(mountPath);
      console.log(`Started VM ${id}`);
      await attachToSession(id);
    } catch (err: any) {
      console.error(`Failed to start VM: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  const opts = parseArgs(args);

  // ── Internal: daemon entry point ───────────────────────────────────────────
  // This branch is only reached when startDaemon() spawns this process with
  // --daemon. The flag is intentionally undocumented in help text.
  if (opts.daemon) {
    if (!opts.id)    { console.error('--daemon requires --id');    process.exit(1); }
    if (!opts.mount) { console.error('--daemon requires --mount'); process.exit(1); }
    await runDaemon(opts.id, opts.mount);
    return;
  }

  // ── --detach: boot VM in background, return immediately ───────────────────
  if (opts.detach) {
    let mountPath: string;
    let isTempMount = false;

    if (opts.mount) {
      if (!fs.existsSync(opts.mount)) {
        console.error(`Error: mount path does not exist: ${opts.mount}`);
        process.exit(1);
      }
      if (!fs.statSync(opts.mount).isDirectory()) {
        console.error(`Error: mount path is not a directory: ${opts.mount}`);
        process.exit(1);
      }
      mountPath = opts.mount;
    } else {
      mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
      isTempMount = true;
    }

    try {
      const id = await startDaemon(mountPath);
      if (isTempMount) {
        console.log(`Started VM ${id} (temp mount: ${mountPath})`);
      } else {
        console.log(`Started VM ${id} (mounted: ${mountPath})`);
      }
    } catch (err: any) {
      console.error(`Failed to start daemon: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Default: ephemeral interactive shell ───────────────────────────────────
  await runInteractive(opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
