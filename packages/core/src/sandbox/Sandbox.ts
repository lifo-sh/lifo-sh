import { Kernel } from '../kernel/index.js';
import { Shell } from '../shell/Shell.js';
import {
  createDefaultRegistry,
} from '../commands/registry.js';
import { createPkgCommand } from '../commands/system/pkg.js';
import { createPsCommand } from '../commands/system/ps.js';
import { createTopCommand } from '../commands/system/top.js';
import { createKillCommand } from '../commands/system/kill.js';
import { createWatchCommand } from '../commands/system/watch.js';
import { createHelpCommand } from '../commands/system/help.js';
import { createNodeCommand } from '../commands/system/node.js';
import { createCurlCommand } from '../commands/net/curl.js';
import { loadInstalledPackages } from '../pkg/loader.js';
import type { VFS } from '../kernel/vfs/index.js';
import type { ITerminal } from '../terminal/ITerminal.js';
import type { SandboxOptions, SandboxCommands, SandboxFs } from './types.js';
import { SandboxFsImpl } from './SandboxFs.js';
import { SandboxCommandsImpl } from './SandboxCommands.js';
import { HeadlessTerminal } from './HeadlessTerminal.js';

export class Sandbox {
  /** Programmatic command execution */
  readonly commands: SandboxCommands;
  /** Filesystem operations */
  readonly fs: SandboxFs;
  /** Environment variables */
  readonly env: Record<string, string>;

  // Power-user escape hatches
  readonly kernel: Kernel;
  readonly shell: Shell;

  private _destroyed = false;

  private constructor(
    kernel: Kernel,
    shell: Shell,
    commands: SandboxCommands,
    fs: SandboxFs,
    env: Record<string, string>,
  ) {
    this.kernel = kernel;
    this.shell = shell;
    this.commands = commands;
    this.fs = fs;
    this.env = env;
  }

  /** Current working directory */
  get cwd(): string {
    return this.shell.getCwd();
  }

  set cwd(path: string) {
    this.shell.setCwd(path);
  }

  /**
   * Create a new Sandbox instance.
   * Orchestrates all boot steps: Kernel, VFS, Registry, Shell, config sourcing.
   */
  static async create(options?: SandboxOptions): Promise<Sandbox> {
    // 1. Create and boot kernel
    const kernel = new Kernel();
    await kernel.boot({ persist: options?.persist ?? false });

    // 2. Create command registry
    const registry = createDefaultRegistry();
    registry.register('pkg', createPkgCommand(registry));
    loadInstalledPackages(kernel.vfs, registry);

    // 3. Pre-populate files if provided
    if (options?.files) {
      for (const [path, content] of Object.entries(options.files)) {
        ensureParentDirs(kernel.vfs, path);
        kernel.vfs.writeFile(path, content);
      }
    }

    // 4. Set up environment
    const defaultEnv = kernel.getDefaultEnv();
    const env = { ...defaultEnv, ...options?.env };
    if (options?.cwd) {
      env.PWD = options.cwd;
    }

    // 5. Create terminal (headless or visual)
    let shellTerminal: ITerminal;
    let isVisual = false;

    if (typeof options?.terminal === 'string' || (typeof HTMLElement !== 'undefined' && options?.terminal instanceof HTMLElement)) {
      // Visual mode: lazy-load xterm.js from @lifo-sh/ui
      const { Terminal } = await import('@lifo-sh/ui');
      const container = resolveContainer(options.terminal);
      const xtermTerminal = new Terminal(container);
      shellTerminal = xtermTerminal;
      isVisual = true;

      // Display MOTD
      const motd = kernel.vfs.readFileString('/etc/motd');
      xtermTerminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    } else if (options?.terminal && typeof options.terminal === 'object') {
      // Pre-created ITerminal instance
      shellTerminal = options.terminal as ITerminal;
      isVisual = true;
    } else {
      // Headless mode
      shellTerminal = new HeadlessTerminal();
    }

    // 6. Create shell
    const shell = new Shell(shellTerminal, kernel.vfs, registry, env);

    // 7. Register factory commands
    const jobTable = shell.getJobTable();
    registry.register('ps', createPsCommand(jobTable));
    registry.register('top', createTopCommand(jobTable));
    registry.register('kill', createKillCommand(jobTable));
    registry.register('watch', createWatchCommand(registry));
    registry.register('help', createHelpCommand(registry));
    registry.register('node', createNodeCommand(kernel.portRegistry));
    registry.register('curl', createCurlCommand(kernel.portRegistry));

    // 8. Source config files
    await shell.sourceFile('/etc/profile');
    await shell.sourceFile(env.HOME + '/.bashrc');

    // 9. Set initial cwd if provided
    if (options?.cwd) {
      shell.setCwd(options.cwd);
    }

    // 10. Start shell (for visual mode, enables interactive input)
    if (isVisual) {
      shell.start();
      shellTerminal.focus();
    }

    // 11. Build the Sandbox
    const getCwd = () => shell.getCwd();
    const sandboxFs = new SandboxFsImpl(kernel.vfs, getCwd);
    const sandboxCommands = new SandboxCommandsImpl(shell, registry);

    return new Sandbox(kernel, shell, sandboxCommands, sandboxFs, env);
  }

  /**
   * Attach a headless sandbox to a DOM element, enabling visual mode.
   */
  async attach(container: HTMLElement): Promise<void> {
    if (this._destroyed) throw new Error('Sandbox is destroyed');
    const { Terminal } = await import('@lifo-sh/ui');
    const xtermTerminal = new Terminal(container);

    const motd = this.kernel.vfs.readFileString('/etc/motd');
    xtermTerminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    xtermTerminal.focus();
  }

  /**
   * Detach from visual mode.
   */
  detach(): void {
    // v1: no-op placeholder
  }

  /**
   * Destroy the sandbox, releasing all resources.
   */
  destroy(): void {
    this._destroyed = true;
  }
}

// ─── Helpers ───

function resolveContainer(target: string | HTMLElement): HTMLElement {
  if (typeof target === 'string') {
    const el = document.querySelector(target);
    if (!el) throw new Error(`Sandbox: element not found: ${target}`);
    return el as HTMLElement;
  }
  return target;
}

function ensureParentDirs(vfs: VFS, filePath: string): void {
  const parts = filePath.split('/').filter(Boolean);
  parts.pop(); // remove filename
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    if (!vfs.exists(current)) {
      vfs.mkdir(current, { recursive: true });
    }
  }
}
