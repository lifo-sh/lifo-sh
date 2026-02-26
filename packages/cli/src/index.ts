import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
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
  createLogoutCommand,
} from '@lifo-sh/core';
import { NodeTerminal } from './NodeTerminal.js';

// ─── Auth ───

const TOKEN_PATH = path.join(os.homedir(), '.lifo-token');
const BASE_URL = process.env.LIFO_BASE_URL || 'http://localhost:3000';
const AUTH_URL = `${BASE_URL}/auth/cli`;

function readToken(): string | null {
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

async function handleLogin() {
  const existing = readToken();
  if (existing) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`, {
        headers: { authorization: `Bearer ${existing}` },
      });
      if (res.ok) {
        const { email } = await res.json();
        process.stdout.write(`Already logged in as ${email}. Login again? (y/N): `);
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const answer: string = await new Promise(resolve => {
          rl2.once('line', line => { rl2.close(); resolve(line.trim().toLowerCase()); });
        });
        if (answer !== 'y') {
          console.log('Aborted.');
          process.exit(0);
        }
      }
    } catch {
      // auth server unreachable, proceed to login
    }
  }

  const link = `\x1b]8;;${AUTH_URL}\x1b\\\x1b[34m${AUTH_URL}\x1b[0m\x1b]8;;\x1b\\`;
  process.stdout.write(`Open this URL in your browser:\n\n  ${link}\n\nPaste your API key: `);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const token: string = await new Promise(resolve => {
    rl.once('line', line => {
      rl.close();
      resolve(line.trim());
    });
  });

  if (!token) {
    console.error('No token provided.');
    process.exit(1);
  }

  if (!token.startsWith('lifo_')) {
    console.error('Invalid API key. It should start with lifo_');
    process.exit(1);
  }

  process.stdout.write('Verifying API key...');
  try {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('\nInvalid API key. Please try again.');
      process.exit(1);
    }
    const { email } = await res.json();
    fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    console.log(` done\nLogged in as ${email}. API key saved to ~/.lifo-token\n`);
  } catch {
    console.error('\nCould not reach auth server. Check your connection.');
    process.exit(1);
  }
}

function handleLogout() {
  try {
    fs.unlinkSync(TOKEN_PATH);
    console.log('Logged out.');
  } catch {
    console.log('Not logged in.');
  }
  process.exit(0);
}

function handleStatus() {
  const token = readToken();
  if (token) {
    console.log(`Logged in. API key: ${token.slice(0, 12)}...`);
  } else {
    console.log('Not logged in. Run: lifo login');
  }
  process.exit(0);
}

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
  if (cmd === 'status') { handleStatus(); return; }

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

  // 5. Load auth token from host filesystem
  const token = readToken();
  if (token) env.LIFO_TOKEN = token;
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
  registry.register('logout', createLogoutCommand(() => fs.unlinkSync(TOKEN_PATH), () => cleanup()));

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
