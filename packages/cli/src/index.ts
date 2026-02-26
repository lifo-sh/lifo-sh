import * as fs from 'node:fs';
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
import { TOKEN_PATH, readToken, handleLogin, handleLogout, handleStatus } from './auth.js';

// ─── CLI argument parsing ───

interface CliOptions {
  mount?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 2; i < argv.length; i++) {
    if ((argv[i] === '--mount' || argv[i] === '-m') && argv[i + 1]) {
      opts.mount = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return opts;
}

// ─── Main ───

async function main() {
  // Handle top-level auth commands before booting the shell
  const cmd = process.argv[2];
  if (cmd === 'login') await handleLogin();  // falls through to boot shell
  if (cmd === 'logout') { handleLogout(); return; }
  if (cmd === 'status') { await handleStatus(); return; }

  const opts = parseArgs(process.argv);
  const terminal = new NodeTerminal();

  // Resolve the host directory to mount
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
    hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifo-'));
    isTempSession = true;
  }

  // 1. Boot kernel
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  // 2. Mount host directory at /mnt/host
  const MOUNT_PATH = '/mnt/host';
  kernel.vfs.mkdir('/mnt', { recursive: true });
  const nativeProvider = new NativeFsProvider(hostDir, fs);
  kernel.vfs.mount(MOUNT_PATH, nativeProvider);

  // 3. Create command registry
  const registry = createDefaultRegistry();
  bootLifoPackages(kernel.vfs, registry);

  // 4. Set up environment
  const env = kernel.getDefaultEnv();
  env.PWD = MOUNT_PATH;
  env.LIFO_HOST_DIR = hostDir;

  // 5. Load auth token from host filesystem (not exposed in shell env)
  const token = readToken();
  env.LIFO_TOKEN_PATH = TOKEN_PATH;

  // 6. Create shell
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  // 7. Register factory commands
  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  const npmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm', createNpmCommand(registry, npmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, npmShellExecute));
  // 8. Source config files
  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');

  // 9. Override exit
  (shell as any).builtins.set(
    'exit',
    async () => {
      terminal.write('logout\r\n');
      cleanup();
      return 0;
    },
  );

  // 10. Display MOTD
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
      try {
        fs.rmSync(hostDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    process.exit(0);
  }

  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
