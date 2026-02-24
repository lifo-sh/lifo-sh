import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Kernel,
  Shell,
  NativeFsProvider,
  createDefaultRegistry,
  loadInstalledPackages,
  createPkgCommand,
  createPsCommand,
  createTopCommand,
  createKillCommand,
  createWatchCommand,
  createHelpCommand,
  createNodeCommand,
  createCurlCommand,
} from '@lifo-sh/core';
import { NodeTerminal } from './NodeTerminal.js';

// ─── CLI argument parsing ───

interface CliOptions {
  mount?: string;   // --mount <path> : host directory to mount
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 2; i < argv.length; i++) {
    if ((argv[i] === '--mount' || argv[i] === '-m') && argv[i + 1]) {
      opts.mount = path.resolve(argv[i + 1]);
      i++; // skip next arg
    }
  }
  return opts;
}

// ─── Main ───

async function main() {
  const opts = parseArgs(process.argv);
  const terminal = new NodeTerminal();

  // Resolve the host directory to mount
  let hostDir: string;
  let isTempSession = false;

  if (opts.mount) {
    // Validate the provided path exists
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
    // Create a temp directory for this session
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
  registry.register('pkg', createPkgCommand(registry));
  loadInstalledPackages(kernel.vfs, registry);

  // 4. Set up environment -- HOME and PWD point to the mounted directory
  const env = kernel.getDefaultEnv();
  env.PWD = MOUNT_PATH;
  env.LIFO_HOST_DIR = hostDir;

  // 5. Create shell
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  // 6. Register factory commands that need shell/kernel references
  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  // 7. Source config files
  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');

  // 8. Override exit to actually terminate the process
  (shell as any).builtins.set(
    'exit',
    async () => {
      terminal.write('logout\r\n');
      cleanup();
      return 0;
    },
  );

  // 9. Display MOTD, then start interactive shell
  const motd = kernel.vfs.readFileString('/etc/motd');
  terminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));

  if (isTempSession) {
    terminal.write(`\x1b[2mTemp session: ${hostDir}\x1b[0m\r\n`);
  } else {
    terminal.write(`\x1b[2mMounted: ${hostDir} -> ${MOUNT_PATH}\x1b[0m\r\n`);
  }

  shell.start();

  // Cleanup handler
  function cleanup() {
    terminal.destroy();
    // Clean up temp directory if it was a temp session
    if (isTempSession) {
      try {
        fs.rmSync(hostDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
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
