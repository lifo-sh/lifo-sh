import { VFS } from './vfs/index.js';
import { ProcProvider } from './vfs/providers/ProcProvider.js';
import { DevProvider } from './vfs/providers/DevProvider.js';
import { PersistenceManager } from './persistence/PersistenceManager.js';
import { installSamples } from './samples.js';

const MOTD = `\x1b[1;36m
 ____                                ___  ____
| __ ) _ __ _____      _____  ___ _ / _ \\/ ___|
|  _ \\| '__/ _ \\ \\ /\\ / / __|/ _ \\ | | | \\___ \\
| |_) | | | (_) \\ V  V /\\__ \\  __/ | |_| |___) |
|____/|_|  \\___/ \\_/\\_/ |___/\\___|_|\\___/|____/
\x1b[0m
\x1b[2mA Linux-like OS running natively in your browser.\x1b[0m
\x1b[2mType 'help' or try: ls, cd, cat, mkdir, touch\x1b[0m
\x1b[2mExplore examples: ls ~/examples/scripts\x1b[0m
`;

const DEFAULT_PROFILE = `export PATH=/usr/bin:/bin
export EDITOR=nano
`;

const DEFAULT_BASHRC = `# Aliases
alias ll='ls -la'
alias la='ls -a'
alias l='ls -1'
alias ..='cd ..'
alias cls='clear'
alias h='history'
`;

export class Kernel {
  vfs: VFS;
  private persistence: PersistenceManager;

  constructor() {
    this.vfs = new VFS();
    this.persistence = new PersistenceManager();
  }

  async boot(): Promise<void> {
    // 1. Load persisted filesystem
    await this.persistence.open();
    const saved = await this.persistence.load();
    if (saved) {
      this.vfs.loadFromSerialized(saved);
    }

    // 2. Initialize standard dirs (idempotent)
    this.initFilesystem();

    // 3. Register virtual providers
    this.vfs.registerProvider('/proc', new ProcProvider());
    this.vfs.registerProvider('/dev', new DevProvider());

    // 4. Hook persistence
    this.vfs.onChange = () => {
      this.persistence.scheduleSave(this.vfs.getRoot());
    };
  }

  initFilesystem(): void {
    const dirs = [
      '/bin',
      '/etc',
      '/home',
      '/home/user',
      '/tmp',
      '/var',
      '/var/log',
      '/usr',
      '/usr/bin',
      '/usr/share',
      '/usr/share/pkg',
      '/usr/share/pkg/node_modules',
    ];

    for (const dir of dirs) {
      try {
        this.vfs.mkdir(dir, { recursive: true });
      } catch {
        // Directory already exists -- ignore
      }
    }

    // Write system files (always overwrite MOTD/hostname)
    this.vfs.writeFile('/etc/motd', MOTD);
    this.vfs.writeFile('/etc/hostname', 'browseros\n');

    // Write default config files only if they don't exist
    if (!this.vfs.exists('/etc/profile')) {
      this.vfs.writeFile('/etc/profile', DEFAULT_PROFILE);
    }
    if (!this.vfs.exists('/home/user/.bashrc')) {
      this.vfs.writeFile('/home/user/.bashrc', DEFAULT_BASHRC);
    }

    // Install example files
    installSamples(this.vfs);
  }

  getDefaultEnv(): Record<string, string> {
    return {
      HOME: '/home/user',
      USER: 'user',
      HOSTNAME: 'browseros',
      SHELL: '/bin/sh',
      PATH: '/usr/bin:/bin',
      TERM: 'xterm-256color',
      PWD: '/home/user',
    };
  }
}
