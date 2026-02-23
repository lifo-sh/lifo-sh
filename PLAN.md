# BrowserOS — A Linux-like Operating System Built on Browser APIs

## Project Vision

Build a complete Linux-like operating system that runs natively in the browser. This is NOT a VM or emulator — it is a reimagination of Unix/Linux where the browser runtime IS the kernel, and browser APIs ARE the system calls. Every layer — filesystem, processes, devices, networking, shell — is implemented using native Web APIs.

The browser already provides memory management, TCP/IP, display rendering, audio, USB, Bluetooth, and more. We are building the **Unix userspace** on top of it.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                  Terminal UI                      │  ← xterm.js + custom theme
├──────────────────────────────────────────────────┤
│                    Shell                          │  ← bash-like interpreter
├──────────────────────────────────────────────────┤
│            Command Registry / $PATH              │  ← ES module command map
├───────────┬────────────┬─────────────────────────┤
│ Coreutils │ Net Cmds   │ User Packages           │  ← each cmd = async function
├───────────┴────────────┴─────────────────────────┤
│          Node.js Compatibility Layer             │  ← thin wrappers over OS APIs
├──────────────────────────────────────────────────┤
│           Virtual Filesystem (VFS)               │  ← OPFS + in-memory + virtual
├──────────────────────────────────────────────────┤
│         Process Manager (Web Workers)            │  ← spawn, signal, pipe, PID
├──────────────────────────────────────────────────┤
│              Kernel API Layer                    │  ← unified browser API wrappers
├──────────────────────────────────────────────────┤
│               Browser APIs                       │  ← fetch, streams, OPFS, etc.
└──────────────────────────────────────────────────┘
```

---

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Build Tool**: Vite
- **Terminal Emulator**: xterm.js + xterm-addon-fit + xterm-addon-webgl
- **Package Manager**: pnpm
- **Testing**: Vitest
- **Module Format**: ESM throughout
- **Target**: Modern browsers (Chrome 110+, Firefox 110+, Safari 16.4+)

---

## Project Structure (Actual)

```
rapidos/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html                          # Entry point -- boots the OS
├── PLAN.md                             # This file
├── src/
│   ├── main.ts                         # Boot sequence: Kernel → Terminal → Registry → Shell
│   ├── kernel/
│   │   ├── index.ts                    # Kernel class: boot(), initFilesystem(), getDefaultEnv()
│   │   ├── vfs/
│   │   │   ├── VFS.ts                  # Virtual Filesystem (synchronous INode tree)
│   │   │   ├── index.ts                # Re-exports VFS, VFSError, ErrorCode, types
│   │   │   ├── types.ts                # INode, Stat, Dirent, VFSError, VirtualProvider
│   │   │   └── providers/
│   │   │       ├── ProcProvider.ts     # /proc virtual provider (uptime, meminfo, cpuinfo, version)
│   │   │       └── DevProvider.ts      # /dev virtual provider (null, zero, random, urandom)
│   │   └── persistence/
│   │       ├── PersistenceManager.ts   # IndexedDB-backed filesystem persistence
│   │       └── serializer.ts           # INode tree serialization/deserialization
│   ├── shell/
│   │   ├── Shell.ts                    # Main shell class (readline, prompt, dispatch)
│   │   ├── lexer.ts                    # Tokenizer (quotes, escapes, operators)
│   │   ├── parser.ts                   # AST parser (pipes, redirects, &&/||, ;, &)
│   │   ├── interpreter.ts             # AST executor (pipelines, redirects, job control)
│   │   ├── expander.ts                # Variable/glob/tilde/brace expansion
│   │   ├── completer.ts              # Tab completion (files, commands, args)
│   │   ├── history.ts                 # Command history with search
│   │   ├── jobs.ts                    # Job control (fg, bg, jobs, &)
│   │   ├── pipe.ts                    # Pipe implementation for pipelines
│   │   └── types.ts                   # Shell AST types (CommandNode, PipelineNode, etc.)
│   ├── commands/
│   │   ├── index.ts                    # Re-exports registry
│   │   ├── registry.ts                # CommandRegistry: register, registerLazy, resolve, list
│   │   ├── types.ts                    # Command type, CommandContext, CommandOutputStream
│   │   ├── fs/                        # 15 filesystem commands
│   │   │   ├── ls.ts                  # ls [-l] [-a] [-R] [-h]
│   │   │   ├── cat.ts                 # cat [-n]
│   │   │   ├── cp.ts                  # cp [-r]
│   │   │   ├── mv.ts                  # mv
│   │   │   ├── rm.ts                  # rm [-r] [-f]
│   │   │   ├── mkdir.ts               # mkdir [-p]
│   │   │   ├── touch.ts              # touch
│   │   │   ├── ln.ts                  # ln (hard links only, no -s)
│   │   │   ├── stat.ts               # stat
│   │   │   ├── find.ts               # find [-name] [-type]
│   │   │   ├── tree.ts               # tree [-L depth]
│   │   │   ├── du.ts                  # du [-s] [-h]
│   │   │   ├── df.ts                  # df [-h]
│   │   │   ├── chmod.ts              # chmod (no-op, parsed)
│   │   │   └── file.ts               # file (type detection)
│   │   ├── text/                      # 10 text processing commands
│   │   │   ├── head.ts               # head [-n]
│   │   │   ├── tail.ts               # tail [-n]
│   │   │   ├── grep.ts               # grep [-i] [-v] [-c] [-n] [-r]
│   │   │   ├── sed.ts                # sed s/pattern/replace/[g]
│   │   │   ├── awk.ts                # awk '{print}' (basic)
│   │   │   ├── cut.ts                # cut -d -f
│   │   │   ├── sort.ts               # sort [-r] [-n] [-u]
│   │   │   ├── uniq.ts               # uniq [-c] [-d]
│   │   │   ├── wc.ts                  # wc [-l] [-w] [-c]
│   │   │   └── tr.ts                  # tr SET1 SET2
│   │   ├── io/                        # 4 I/O commands
│   │   │   ├── printf.ts             # printf FORMAT [ARGS]
│   │   │   ├── tee.ts                # tee [-a] FILE
│   │   │   ├── xargs.ts              # xargs COMMAND
│   │   │   └── yes.ts                # yes [STRING]
│   │   ├── net/                       # 4 network commands
│   │   │   ├── curl.ts               # curl [-o] [-s] [-X] [-H] [-d]
│   │   │   ├── wget.ts               # wget [-O] [-q]
│   │   │   ├── ping.ts               # ping [-c count]
│   │   │   └── dig.ts                # dig (DNS over HTTPS)
│   │   ├── system/                    # 11 system commands
│   │   │   ├── date.ts               # date [+FORMAT]
│   │   │   ├── env.ts                # env
│   │   │   ├── free.ts               # free [-h]
│   │   │   ├── hostname.ts           # hostname
│   │   │   ├── sleep.ts              # sleep SECONDS
│   │   │   ├── uname.ts              # uname [-a]
│   │   │   ├── uptime.ts             # uptime
│   │   │   ├── which.ts              # which COMMAND
│   │   │   ├── whoami.ts             # whoami
│   │   │   ├── node.ts               # node [-e code] [script.js] [args]
│   │   │   └── pkg.ts                # pkg install/remove/list/info
│   │   └── archive/                   # 5 archive commands
│   │       ├── tar.ts                 # tar -c/-x/-t [-z] [-v] [-f] [-C]
│   │       ├── gzip.ts               # gzip [-k] [-d]
│   │       ├── gunzip.ts             # gunzip [-k]
│   │       ├── zip.ts                # zip archive.zip files...
│   │       └── unzip.ts              # unzip [-l] [-d dir]
│   ├── node-compat/                   # Node.js compatibility layer (15 modules)
│   │   ├── index.ts                   # NodeContext, createModuleMap() -- 17 module mappings
│   │   ├── fs.ts                      # createFs(vfs, cwd) -- sync/callback/promises APIs
│   │   ├── path.ts                    # Wraps src/utils/path.ts + relative/parse/format
│   │   ├── process.ts                # createProcess() -- argv, env, exit (ProcessExitError)
│   │   ├── os.ts                      # createOs() -- hostname, cpus, homedir, etc.
│   │   ├── events.ts                 # EventEmitter class
│   │   ├── buffer.ts                 # Buffer class extending Uint8Array
│   │   ├── util.ts                    # format(), inspect(), promisify()
│   │   ├── console.ts               # createConsole() -- log/warn/error via util.format
│   │   ├── http.ts                    # request()/get() via fetch(), IncomingMessage
│   │   ├── child_process.ts          # exec() via interpreter executeCapture()
│   │   ├── stream.ts                 # Minimal Readable/Writable/Duplex/PassThrough
│   │   ├── url.ts                     # Re-exports URL/URLSearchParams + parse/format
│   │   ├── timers.ts                 # Re-exports setTimeout etc. + setImmediate shim
│   │   └── crypto.ts                 # randomBytes (Web Crypto), createHash (SubtleCrypto)
│   ├── pkg/                           # Package manager
│   │   ├── PackageManager.ts          # install(url), remove(name), list(), info(name)
│   │   └── loader.ts                 # loadInstalledPackages() -- boot-time re-registration
│   ├── terminal/
│   │   └── Terminal.ts                # xterm.js wrapper + input handling
│   └── utils/
│       ├── archive.ts                 # CRC-32, gzip, tar (ustar), zip format utilities
│       ├── encoding.ts                # encode/decode (TextEncoder/TextDecoder) + concatBytes
│       ├── glob.ts                    # Glob pattern matching (minimatch-like)
│       ├── args.ts                    # parseArgs (getopt-like with ArgSpec)
│       ├── path.ts                    # normalize, join, resolve, dirname, basename, extname
│       └── colors.ts                  # ANSI color helpers
└── tests/
    ├── kernel/
    │   ├── vfs.test.ts                # VFS operations, permissions, edge cases
    │   ├── persistence.test.ts        # IndexedDB persistence round-trips
    │   └── virtual-providers.test.ts  # /proc and /dev provider tests
    ├── shell/
    │   ├── lexer.test.ts              # Tokenizer tests
    │   ├── parser.test.ts             # AST parser tests
    │   ├── shell.test.ts              # End-to-end shell integration tests
    │   └── source-alias.test.ts       # source/alias builtin tests
    ├── commands/
    │   ├── fs.test.ts                 # Filesystem command tests
    │   ├── text.test.ts               # Text processing command tests
    │   ├── io.test.ts                 # I/O command tests
    │   ├── system.test.ts             # System command tests
    │   ├── net.test.ts                # Network command tests
    │   ├── archive.test.ts            # Archive command tests (tar, gzip, zip)
    │   ├── node.test.ts               # node command tests
    │   └── pkg.test.ts                # pkg command tests
    ├── node-compat/
    │   ├── fs.test.ts                 # Node fs module tests
    │   ├── path.test.ts               # Node path module tests
    │   ├── events.test.ts             # EventEmitter tests
    │   └── buffer.test.ts             # Buffer class tests
    └── utils/
        ├── archive.test.ts            # Archive utility unit tests
        └── path.test.ts               # Path utility tests
```

---

## Phase 1: Kernel Layer

### 1.1 Virtual Filesystem (VFS)

The VFS is the core of the OS. It provides a unified POSIX-like filesystem interface over multiple backends.

#### VFS Types

```typescript
// src/kernel/vfs/types.ts

export interface Stat {
  dev: number;
  ino: number;
  mode: number;        // File permissions (rwxrwxrwx)
  nlink: number;
  uid: number;
  gid: number;
  size: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}

export interface INode {
  ino: number;
  type: 'file' | 'directory' | 'symlink' | 'device' | 'pipe';
  mode: number;
  uid: number;
  gid: number;
  size: number;
  data: Uint8Array | null;       // File content
  children: Map<string, INode>;  // Directory entries
  target: string | null;         // Symlink target
  device: DeviceDriver | null;   // Device driver reference
  atime: Date;
  mtime: Date;
  ctime: Date;
}

export interface FileDescriptor {
  inode: INode;
  position: number;
  flags: number;        // O_RDONLY, O_WRONLY, O_RDWR, O_APPEND, etc.
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export interface MountPoint {
  path: string;
  backend: FSBackend;
  options: MountOptions;
}

export interface FSBackend {
  name: string;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  stat(path: string): Promise<Stat>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, mode?: number): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
}

export interface DeviceDriver {
  read(size?: number): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<number>;
  ioctl?(request: number, arg: any): Promise<any>;
  close(): Promise<void>;
}
```

#### VFS Core Implementation

```typescript
// src/kernel/vfs/VFS.ts

export class VFS {
  private root: INode;
  private mounts: Map<string, FSBackend>;
  private fds: Map<number, FileDescriptor>;
  private nextFd: number;
  private nextIno: number;

  constructor() {
    this.root = this.createDirectory();
    this.mounts = new Map();
    this.fds = new Map();
    this.nextFd = 3;  // 0=stdin, 1=stdout, 2=stderr reserved
    this.nextIno = 1;
  }

  // Mount a backend at a path
  async mount(path: string, backend: FSBackend, options?: MountOptions): Promise<void>;

  // Unmount a path
  async umount(path: string): Promise<void>;

  // Core POSIX operations
  async open(path: string, flags: number, mode?: number): Promise<number>;  // returns fd
  async close(fd: number): Promise<void>;
  async read(fd: number, size?: number): Promise<Uint8Array>;
  async write(fd: number, data: Uint8Array): Promise<number>;
  async seek(fd: number, offset: number, whence: number): Promise<number>;

  // File operations
  async stat(path: string): Promise<Stat>;
  async lstat(path: string): Promise<Stat>;
  async readFile(path: string): Promise<Uint8Array>;
  async writeFile(path: string, data: Uint8Array): Promise<void>;
  async appendFile(path: string, data: Uint8Array): Promise<void>;
  async unlink(path: string): Promise<void>;
  async rename(oldPath: string, newPath: string): Promise<void>;
  async symlink(target: string, path: string): Promise<void>;
  async readlink(path: string): Promise<string>;
  async realpath(path: string): Promise<string>;
  async chmod(path: string, mode: number): Promise<void>;
  async chown(path: string, uid: number, gid: number): Promise<void>;

  // Directory operations
  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  async rmdir(path: string): Promise<void>;
  async readdir(path: string): Promise<string[]>;
  async readdirStat(path: string): Promise<Array<{ name: string; stat: Stat }>>;

  // Path helpers
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  join(...paths: string[]): string;

  // Pipe creation
  createPipe(): [ReadableStream<Uint8Array>, WritableStream<Uint8Array>];
}
```

#### Filesystem Hierarchy

On boot, initialize this directory structure:

```
/
├── home/
│   └── user/               # User home directory ($HOME)
│       ├── .bashrc          # Shell config
│       └── .profile         # Login profile
├── tmp/                     # Temporary files (in-memory, cleared on reload)
├── etc/
│   ├── profile              # System-wide shell profile
│   ├── hostname             # System hostname
│   ├── passwd               # User database
│   ├── motd                 # Message of the day
│   └── packages.json        # Package registry config
├── var/
│   ├── log/                 # System logs
│   └── tmp/                 # Persistent temp
├── usr/
│   ├── bin/                 # Installed command binaries (packages)
│   └── share/
│       └── man/             # Man pages
├── mnt/                     # Mount points for external storage
│   ├── gdrive/              # Google Drive (if connected)
│   ├── s3/                  # S3 bucket (if connected)
│   └── local/               # File System Access API (local disk)
├── proc/                    # Virtual: process and system info
│   ├── cpuinfo              # navigator.hardwareConcurrency
│   ├── meminfo              # performance.memory
│   ├── uptime               # performance.now() since boot
│   ├── version              # OS version info
│   ├── battery              # Battery API
│   ├── net/                 # Network connection info
│   │   └── info             # navigator.connection
│   ├── self/                # Current process info
│   │   ├── cwd              # Current working directory
│   │   ├── env              # Environment variables
│   │   └── fd/              # Open file descriptors
│   └── [pid]/               # Per-process directories
│       ├── status            # Process status
│       ├── cmdline           # Command that started the process
│       └── fd/               # File descriptors
├── dev/                     # Virtual: device files
│   ├── null                 # Discards all writes, reads empty
│   ├── zero                 # Reads infinite zero bytes
│   ├── random               # crypto.getRandomValues()
│   ├── urandom              # crypto.getRandomValues()
│   ├── clipboard            # Clipboard API (read/write)
│   ├── stdin                # Terminal standard input
│   ├── stdout               # Terminal standard output
│   ├── stderr               # Terminal standard error
│   ├── tty                  # Current terminal
│   ├── speaker              # Web Audio API output
│   ├── mic                  # MediaDevices audio input
│   ├── camera               # MediaDevices video input
│   ├── screen               # Screen/display info
│   ├── gpu                  # WebGPU device info
│   ├── usb/                 # Web USB devices
│   ├── bluetooth/           # Web Bluetooth devices
│   ├── serial/              # Web Serial ports
│   ├── gamepad/             # Gamepad API devices
│   └── midi/                # Web MIDI devices
└── bin/                     # Core commands (symlinks/registry)
```

#### /proc Virtual Filesystem

```typescript
// src/kernel/vfs/virtual/ProcFS.ts

// Each file in /proc is dynamically generated on read.
// Writing to certain files changes system state.

export class ProcFS implements FSBackend {
  name = 'procfs';

  private generators: Map<string, () => Promise<Uint8Array>> = new Map([

    // /proc/cpuinfo → navigator.hardwareConcurrency
    ['cpuinfo', async () => {
      const cores = navigator.hardwareConcurrency || 1;
      const info = Array.from({ length: cores }, (_, i) =>
        `processor\t: ${i}\nmodel name\t: Browser Virtual CPU\ncpu cores\t: ${cores}\n`
      ).join('\n');
      return new TextEncoder().encode(info);
    }],

    // /proc/meminfo → performance.memory (Chrome) or estimation
    ['meminfo', async () => {
      const mem = (performance as any).memory;
      const lines = mem ? [
        `MemTotal:       ${Math.round(mem.jsHeapSizeLimit / 1024)} kB`,
        `MemUsed:        ${Math.round(mem.usedJSHeapSize / 1024)} kB`,
        `MemAvailable:   ${Math.round((mem.jsHeapSizeLimit - mem.usedJSHeapSize) / 1024)} kB`,
        `HeapTotal:      ${Math.round(mem.totalJSHeapSize / 1024)} kB`,
      ] : [`MemTotal:       unknown`, `MemAvailable:   unknown`];
      return new TextEncoder().encode(lines.join('\n') + '\n');
    }],

    // /proc/uptime → time since page load
    ['uptime', async () => {
      const uptimeSeconds = (performance.now() / 1000).toFixed(2);
      return new TextEncoder().encode(`${uptimeSeconds} 0.00\n`);
    }],

    // /proc/version → OS version string
    ['version', async () => {
      const ua = navigator.userAgent;
      return new TextEncoder().encode(
        `BrowserOS 1.0.0 (${ua})\n`
      );
    }],

    // /proc/battery → Battery API
    ['battery', async () => {
      try {
        const battery = await (navigator as any).getBattery();
        const lines = [
          `present:        1`,
          `status:         ${battery.charging ? 'Charging' : 'Discharging'}`,
          `capacity:       ${Math.round(battery.level * 100)}%`,
          `charge_time:    ${battery.chargingTime === Infinity ? 'N/A' : battery.chargingTime + 's'}`,
          `discharge_time: ${battery.dischargingTime === Infinity ? 'N/A' : battery.dischargingTime + 's'}`,
        ];
        return new TextEncoder().encode(lines.join('\n') + '\n');
      } catch {
        return new TextEncoder().encode('Battery API not available\n');
      }
    }],

    // /proc/net/info → navigator.connection
    ['net/info', async () => {
      const conn = (navigator as any).connection;
      if (!conn) return new TextEncoder().encode('Network Information API not available\n');
      const lines = [
        `type:           ${conn.effectiveType || 'unknown'}`,
        `downlink:       ${conn.downlink || 'unknown'} Mbps`,
        `rtt:            ${conn.rtt || 'unknown'} ms`,
        `saveData:       ${conn.saveData ? 'yes' : 'no'}`,
      ];
      return new TextEncoder().encode(lines.join('\n') + '\n');
    }],
  ]);

  async read(path: string): Promise<Uint8Array> {
    // Strip leading /proc/
    const relPath = path.replace(/^\/proc\//, '');
    const generator = this.generators.get(relPath);
    if (!generator) throw new Error(`ENOENT: ${path}`);
    return generator();
  }

  // ... implement other FSBackend methods
}
```

#### /dev Virtual Filesystem

```typescript
// src/kernel/vfs/virtual/DevFS.ts

// Devices are character devices. Reading/writing maps to browser APIs.

export class DevFS implements FSBackend {
  name = 'devfs';
  private devices: Map<string, DeviceDriver>;

  constructor(deviceManager: DeviceManager) {
    this.devices = deviceManager.getAll();
  }
  // ... routes reads/writes to the appropriate DeviceDriver
}

// Example device implementations:

// /dev/null — discards all writes, reads return empty
export class NullDevice implements DeviceDriver {
  async read(): Promise<Uint8Array> { return new Uint8Array(0); }
  async write(data: Uint8Array): Promise<number> { return data.length; }
  async close(): Promise<void> {}
}

// /dev/zero — reads return zero bytes
export class ZeroDevice implements DeviceDriver {
  async read(size = 1024): Promise<Uint8Array> { return new Uint8Array(size); }
  async write(data: Uint8Array): Promise<number> { return data.length; }
  async close(): Promise<void> {}
}

// /dev/random — reads return cryptographic random bytes
export class RandomDevice implements DeviceDriver {
  async read(size = 1024): Promise<Uint8Array> {
    const buf = new Uint8Array(size);
    crypto.getRandomValues(buf);
    return buf;
  }
  async write(): Promise<number> { return 0; }
  async close(): Promise<void> {}
}

// /dev/clipboard — read = paste, write = copy
export class ClipboardDevice implements DeviceDriver {
  async read(): Promise<Uint8Array> {
    const text = await navigator.clipboard.readText();
    return new TextEncoder().encode(text);
  }
  async write(data: Uint8Array): Promise<number> {
    const text = new TextDecoder().decode(data);
    await navigator.clipboard.writeText(text);
    return data.length;
  }
  async close(): Promise<void> {}
}

// /dev/speaker — write text to get TTS, or write audio data
export class AudioDevice implements DeviceDriver {
  async read(): Promise<Uint8Array> { return new Uint8Array(0); }
  async write(data: Uint8Array): Promise<number> {
    const text = new TextDecoder().decode(data);
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
    return data.length;
  }
  async close(): Promise<void> { speechSynthesis.cancel(); }
}
```

### 1.2 Process Manager

Every "process" runs in a Web Worker. The Process Manager handles the PID table, spawning, termination, signals, and inter-process communication.

```typescript
// src/kernel/process/types.ts

export interface ProcessInfo {
  pid: number;
  ppid: number;          // Parent PID
  pgid: number;          // Process group ID
  name: string;          // Command name
  args: string[];        // Arguments
  status: 'running' | 'sleeping' | 'stopped' | 'zombie';
  exitCode: number | null;
  startTime: number;     // performance.now() timestamp
  worker: Worker | null; // null for main-thread processes
  env: Record<string, string>;
  cwd: string;
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
  stderr: WritableStream<Uint8Array>;
  abortController: AbortController;
}

export enum Signal {
  SIGHUP = 1,
  SIGINT = 2,       // Ctrl+C
  SIGQUIT = 3,
  SIGKILL = 9,      // Force kill
  SIGTERM = 15,      // Graceful terminate
  SIGSTOP = 19,      // Pause
  SIGCONT = 18,      // Resume
  SIGCHLD = 17,      // Child process state change
  SIGPIPE = 13,      // Broken pipe
}
```

```typescript
// src/kernel/process/ProcessManager.ts

export class ProcessManager {
  private processes: Map<number, ProcessInfo>;
  private nextPid: number;

  constructor() {
    this.processes = new Map();
    this.nextPid = 1;
    // PID 0 = kernel/idle, PID 1 = init (shell)
  }

  // Spawn a new process
  // For built-in commands: runs on main thread as async function
  // For Worker commands: spawns a Web Worker
  async spawn(options: {
    name: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    stdin?: ReadableStream<Uint8Array>;
    stdout?: WritableStream<Uint8Array>;
    stderr?: WritableStream<Uint8Array>;
    background?: boolean;
  }): Promise<number>;  // returns PID

  // Send a signal to a process
  async kill(pid: number, signal: Signal): Promise<void>;

  // Wait for a process to exit
  async waitpid(pid: number): Promise<{ exitCode: number }>;

  // List all processes
  list(): ProcessInfo[];

  // Get process by PID
  get(pid: number): ProcessInfo | undefined;

  // Create a pipe between two processes
  pipe(): [ReadableStream<Uint8Array>, WritableStream<Uint8Array>];
}
```

#### Pipe Implementation

Pipes use the Web Streams API — this is native and performant:

```typescript
// src/kernel/process/pipe.ts

export function createPipe(): [ReadableStream<Uint8Array>, WritableStream<Uint8Array>] {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { /* pipe broken */ }
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) { controller.enqueue(chunk); },
    close() { controller.close(); },
    abort(reason) { controller.error(reason); }
  });

  return [readable, writable];
}

// Usage for: ls | grep foo | wc -l
// const [r1, w1] = createPipe();
// const [r2, w2] = createPipe();
// spawn('ls',  { stdout: w1 });
// spawn('grep', { stdin: r1, stdout: w2, args: ['foo'] });
// spawn('wc',   { stdin: r2, stdout: terminalStdout, args: ['-l'] });
```

### 1.3 Signal Handling

```typescript
// src/kernel/process/signals.ts

// Ctrl+C in terminal sends SIGINT to foreground process group
// Implementation: AbortController per process

export class SignalManager {
  private handlers: Map<number, Map<Signal, () => void>>;  // pid -> signal -> handler

  // Register a signal handler for a process
  on(pid: number, signal: Signal, handler: () => void): void;

  // Deliver a signal to a process
  async deliver(pid: number, signal: Signal): Promise<void> {
    const process = this.processManager.get(pid);
    if (!process) return;

    switch (signal) {
      case Signal.SIGKILL:
        // Force kill: terminate Worker immediately
        process.worker?.terminate();
        process.status = 'zombie';
        process.exitCode = 137;
        break;

      case Signal.SIGINT:
      case Signal.SIGTERM:
        // Graceful: trigger AbortController, let process handle it
        process.abortController.abort();
        break;

      case Signal.SIGSTOP:
        // Pause: no direct Worker API, but we can block message passing
        process.status = 'stopped';
        break;

      case Signal.SIGCONT:
        process.status = 'running';
        break;
    }
  }
}
```

---

## Phase 2: Shell

The shell is the primary user interface. It must parse, expand, and execute commands with full support for pipes, redirects, job control, variables, and scripting.

### 2.1 Shell Grammar (Subset of POSIX sh + Bash extensions)

```
program       := pipeline_list
pipeline_list := pipeline ((';' | '&&' | '||' | '&' | '\n') pipeline)*
pipeline      := ['!'] command ('|' command)*
command       := simple_command | compound_command | function_def
simple_command := assignment* word+ redirection*
compound_command := if_clause | for_clause | while_clause | case_clause
                  | '{' pipeline_list '}' | '(' pipeline_list ')'
if_clause     := 'if' pipeline_list 'then' pipeline_list
                 ('elif' pipeline_list 'then' pipeline_list)*
                 ('else' pipeline_list)? 'fi'
for_clause    := 'for' WORD 'in' word* ';' 'do' pipeline_list 'done'
while_clause  := 'while' pipeline_list 'do' pipeline_list 'done'
case_clause   := 'case' word 'in' case_item* 'esac'
case_item     := pattern ('|' pattern)* ')' pipeline_list ';;'
function_def  := WORD '()' '{' pipeline_list '}'
redirection   := ('>' | '>>' | '<' | '2>' | '2>>' | '&>' | '<<' | '<<<') word
assignment    := WORD '=' word
word          := WORD | "'" ... "'" | '"' ... '"' | '$(' pipeline ')' | '`' pipeline '`'
                | '$((' expression '))' | '${' parameter_expansion '}'
```

### 2.2 Lexer Tokens

```typescript
// src/shell/types.ts

export enum TokenType {
  WORD,           // Any unquoted word
  STRING_SINGLE,  // 'single quoted'
  STRING_DOUBLE,  // "double quoted" (with expansion)
  PIPE,           // |
  AND,            // &&
  OR,             // ||
  SEMI,           // ;
  AMP,            // & (background)
  NEWLINE,        // \n
  REDIRECT_OUT,   // >
  REDIRECT_APPEND,// >>
  REDIRECT_IN,    // <
  REDIRECT_ERR,   // 2>
  REDIRECT_ERR_APPEND, // 2>>
  REDIRECT_ALL,   // &>
  HEREDOC,        // <<
  HERESTRING,     // <<<
  LPAREN,         // (
  RPAREN,         // )
  LBRACE,         // {
  RBRACE,         // }
  BANG,           // !
  IF, THEN, ELIF, ELSE, FI,
  FOR, WHILE, UNTIL, DO, DONE,
  CASE, ESAC, IN,
  FUNCTION,
  ASSIGNMENT,     // VAR=value
  DOLLAR,         // $VAR, ${VAR}, $(cmd), $((expr))
  BACKTICK,       // `cmd`
  GLOB,           // *, ?, [...]
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// AST Nodes
export interface PipelineNode {
  type: 'pipeline';
  commands: CommandNode[];
  negated: boolean;
  background: boolean;
}

export interface SimpleCommandNode {
  type: 'simple_command';
  name: string;
  args: string[];
  assignments: Array<{ name: string; value: string }>;
  redirections: RedirectionNode[];
}

export interface RedirectionNode {
  type: 'redirection';
  operator: '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '<<' | '<<<';
  target: string;
}

export interface IfNode {
  type: 'if';
  condition: PipelineNode[];
  then: PipelineNode[];
  elif: Array<{ condition: PipelineNode[]; then: PipelineNode[] }>;
  else_: PipelineNode[] | null;
}

export interface ForNode {
  type: 'for';
  variable: string;
  items: string[];
  body: PipelineNode[];
}

export interface WhileNode {
  type: 'while';
  condition: PipelineNode[];
  body: PipelineNode[];
}

export interface CaseNode {
  type: 'case';
  word: string;
  items: Array<{ patterns: string[]; body: PipelineNode[] }>;
}

export interface FunctionNode {
  type: 'function';
  name: string;
  body: PipelineNode[];
}
```

### 2.3 Expansion Order

The shell expands in this order (matching Bash):

1. **Brace expansion**: `{a,b,c}` → `a b c`
2. **Tilde expansion**: `~` → `$HOME`, `~user` → `/home/user`
3. **Parameter expansion**: `$VAR`, `${VAR:-default}`, `${VAR#prefix}`, `${#VAR}`, etc.
4. **Command substitution**: `$(command)` or `` `command` ``
5. **Arithmetic expansion**: `$((1 + 2))`
6. **Word splitting**: Split on `$IFS` (default: space, tab, newline)
7. **Glob expansion**: `*.txt`, `**/*.js`, `[abc]`, `?`
8. **Quote removal**: Remove remaining quotes

### 2.4 Shell Built-in Commands

These must be built into the shell because they modify shell state:

```typescript
// src/shell/builtins.ts

export const builtins: Record<string, BuiltinFn> = {
  cd:       async (args, shell) => { /* change shell.cwd */ },
  pwd:      async (args, shell) => { /* print shell.cwd */ },
  export:   async (args, shell) => { /* set env var and mark for child export */ },
  unset:    async (args, shell) => { /* remove variable */ },
  set:      async (args, shell) => { /* set shell options or positional params */ },
  alias:    async (args, shell) => { /* define alias */ },
  unalias:  async (args, shell) => { /* remove alias */ },
  source:   async (args, shell) => { /* execute file in current shell context (aka .) */ },
  exit:     async (args, shell) => { /* exit shell with code */ },
  return:   async (args, shell) => { /* return from function */ },
  shift:    async (args, shell) => { /* shift positional parameters */ },
  read:     async (args, shell) => { /* read line from stdin into variable */ },
  eval:     async (args, shell) => { /* evaluate string as shell command */ },
  exec:     async (args, shell) => { /* replace shell process with command */ },
  trap:     async (args, shell) => { /* set signal handlers */ },
  jobs:     async (args, shell) => { /* list background jobs */ },
  fg:       async (args, shell) => { /* bring job to foreground */ },
  bg:       async (args, shell) => { /* resume job in background */ },
  wait:     async (args, shell) => { /* wait for background job */ },
  history:  async (args, shell) => { /* show command history */ },
  type:     async (args, shell) => { /* show command type (builtin/alias/function/external) */ },
  test:     async (args, shell) => { /* conditional expression (aka [) */ },
  true:     async () => 0,
  false:    async () => 1,
  ':':      async () => 0,  // no-op
  echo:     async (args, shell) => { /* write args to stdout */ },
  printf:   async (args, shell) => { /* formatted output */ },
  local:    async (args, shell) => { /* declare local variable in function scope */ },
  declare:  async (args, shell) => { /* declare variable with attributes */ },
  readonly: async (args, shell) => { /* mark variable as read-only */ },
  getopts:  async (args, shell) => { /* parse positional parameters */ },
  let:      async (args, shell) => { /* arithmetic evaluation */ },
  hash:     async (args, shell) => { /* manage command hash table */ },
  enable:   async (args, shell) => { /* enable/disable builtins */ },
  help:     async (args, shell) => { /* show help for builtins */ },
};
```

### 2.5 Tab Completion

```typescript
// src/shell/completer.ts

export class Completer {
  // Context-aware completion:
  // 1. If cursor is at position 0 or after |, ;, &&, || → complete command names
  //    - Search: builtins, aliases, functions, commands in $PATH, files with +x
  // 2. If cursor is after a command name → complete arguments
  //    - Default: file/directory completion
  //    - Special: cd completes only directories
  //    - Special: man completes command names
  //    - Special: kill completes PIDs
  //    - Special: after > or >> → file completion
  //    - Custom: per-command completion specs
  // 3. If cursor is after $ → complete variable names
  // 4. If cursor is after ~ → complete usernames

  async complete(line: string, cursorPos: number): Promise<string[]>;
}
```

---

## Phase 3: Command Interface

### 3.1 Command Contract

Every command is an async function with this signature:

```typescript
// src/commands/types.ts

export interface CommandContext {
  args: string[];                              // Parsed arguments
  env: Record<string, string>;                 // Environment variables
  cwd: string;                                 // Current working directory
  stdin: ReadableStream<Uint8Array>;           // Standard input
  stdout: WritableStream<Uint8Array>;          // Standard output
  stderr: WritableStream<Uint8Array>;          // Standard error
  signal: AbortSignal;                         // For Ctrl+C handling
  vfs: VFS;                                    // Filesystem access
  processManager: ProcessManager;              // Process info
  kernel: Kernel;                              // Full kernel access
}

// Every command exports this type
export type Command = (ctx: CommandContext) => Promise<number>;  // returns exit code

// Helper to write text to stdout/stderr
export async function writeOut(ctx: CommandContext, text: string): Promise<void> {
  const writer = ctx.stdout.getWriter();
  await writer.write(new TextEncoder().encode(text));
  writer.releaseLock();
}

export async function writeErr(ctx: CommandContext, text: string): Promise<void> {
  const writer = ctx.stderr.getWriter();
  await writer.write(new TextEncoder().encode(text));
  writer.releaseLock();
}

// Helper to read all of stdin as text
export async function readStdin(ctx: CommandContext): Promise<string> {
  const reader = ctx.stdin.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(concatUint8Arrays(chunks));
}
```

### 3.2 Command Registry

```typescript
// src/commands/index.ts

// All core commands registered here.
// The registry acts as $PATH — the shell looks up commands here.

export class CommandRegistry {
  private commands: Map<string, Command | (() => Promise<{ default: Command }>)>;

  constructor() {
    this.commands = new Map();
    this.registerCoreCommands();
  }

  // Register a command
  register(name: string, command: Command): void;

  // Register a lazy-loaded command (loaded on first use)
  registerLazy(name: string, loader: () => Promise<{ default: Command }>): void;

  // Look up a command by name
  async resolve(name: string): Promise<Command | null>;

  // List all available commands
  list(): string[];

  private registerCoreCommands() {
    // Filesystem commands
    this.registerLazy('ls',       () => import('./fs/ls'));
    this.registerLazy('cat',      () => import('./fs/cat'));
    this.registerLazy('cp',       () => import('./fs/cp'));
    this.registerLazy('mv',       () => import('./fs/mv'));
    this.registerLazy('rm',       () => import('./fs/rm'));
    this.registerLazy('mkdir',    () => import('./fs/mkdir'));
    this.registerLazy('rmdir',    () => import('./fs/rmdir'));
    this.registerLazy('touch',    () => import('./fs/touch'));
    this.registerLazy('find',     () => import('./fs/find'));
    this.registerLazy('tree',     () => import('./fs/tree'));
    this.registerLazy('du',       () => import('./fs/du'));
    this.registerLazy('df',       () => import('./fs/df'));
    this.registerLazy('chmod',    () => import('./fs/chmod'));
    this.registerLazy('stat',     () => import('./fs/stat'));
    this.registerLazy('ln',       () => import('./fs/ln'));
    this.registerLazy('realpath', () => import('./fs/realpath'));
    this.registerLazy('basename', () => import('./fs/basename'));
    this.registerLazy('dirname',  () => import('./fs/dirname'));
    this.registerLazy('mktemp',   () => import('./fs/mktemp'));
    this.registerLazy('file',     () => import('./fs/file'));

    // Text processing
    this.registerLazy('head',     () => import('./text/head'));
    this.registerLazy('tail',     () => import('./text/tail'));
    this.registerLazy('grep',     () => import('./text/grep'));
    this.registerLazy('sed',      () => import('./text/sed'));
    this.registerLazy('awk',      () => import('./text/awk'));
    this.registerLazy('cut',      () => import('./text/cut'));
    this.registerLazy('sort',     () => import('./text/sort'));
    this.registerLazy('uniq',     () => import('./text/uniq'));
    this.registerLazy('wc',       () => import('./text/wc'));
    this.registerLazy('tr',       () => import('./text/tr'));
    this.registerLazy('tee',      () => import('./text/tee'));
    this.registerLazy('diff',     () => import('./text/diff'));
    this.registerLazy('nl',       () => import('./text/nl'));
    this.registerLazy('rev',      () => import('./text/rev'));
    this.registerLazy('paste',    () => import('./text/paste'));
    this.registerLazy('fold',     () => import('./text/fold'));
    this.registerLazy('fmt',      () => import('./text/fmt'));

    // I/O
    this.registerLazy('xargs',    () => import('./io/xargs'));
    this.registerLazy('yes',      () => import('./io/yes'));

    // Networking
    this.registerLazy('curl',     () => import('./net/curl'));
    this.registerLazy('wget',     () => import('./net/wget'));
    this.registerLazy('ping',     () => import('./net/ping'));
    this.registerLazy('nc',       () => import('./net/nc'));
    this.registerLazy('dig',      () => import('./net/dig'));

    // System
    this.registerLazy('ps',       () => import('./system/ps'));
    this.registerLazy('top',      () => import('./system/top'));
    this.registerLazy('kill',     () => import('./system/kill'));
    this.registerLazy('uptime',   () => import('./system/uptime'));
    this.registerLazy('free',     () => import('./system/free'));
    this.registerLazy('env',      () => import('./system/env'));
    this.registerLazy('uname',    () => import('./system/uname'));
    this.registerLazy('whoami',   () => import('./system/whoami'));
    this.registerLazy('hostname', () => import('./system/hostname'));
    this.registerLazy('sleep',    () => import('./system/sleep'));
    this.registerLazy('watch',    () => import('./system/watch'));
    this.registerLazy('date',     () => import('./system/date'));
    this.registerLazy('cal',      () => import('./system/cal'));
    this.registerLazy('bc',       () => import('./system/bc'));
    this.registerLazy('clear',    () => import('./system/clear'));
    this.registerLazy('which',    () => import('./system/which'));
    this.registerLazy('man',      () => import('./system/man'));
    this.registerLazy('help',     () => import('./system/help'));

    // Archive
    this.registerLazy('tar',      () => import('./archive/tar'));
    this.registerLazy('gzip',     () => import('./archive/gzip'));
    this.registerLazy('gunzip',   () => import('./archive/gunzip'));
    this.registerLazy('zip',      () => import('./archive/zip'));
    this.registerLazy('unzip',    () => import('./archive/unzip'));
  }
}
```

### 3.3 Example Command Implementations

```typescript
// src/commands/fs/ls.ts
// Implements: ls [-l] [-a] [-h] [-R] [-1] [-S] [-t] [-r] [path...]

import { Command, CommandContext, writeOut } from '../types';
import { parseArgs } from '../../utils/args';

const ls: Command = async (ctx: CommandContext): Promise<number> => {
  const { flags, positional } = parseArgs(ctx.args, {
    boolean: ['l', 'a', 'h', 'R', '1', 'S', 't', 'r'],
    alias: { all: 'a', long: 'l', human: 'h', recursive: 'R', reverse: 'r' }
  });

  const targets = positional.length > 0 ? positional : [ctx.cwd];

  for (const target of targets) {
    const fullPath = ctx.vfs.resolve(ctx.cwd, target);

    try {
      const stat = await ctx.vfs.stat(fullPath);

      if (!stat.isDirectory()) {
        // It's a file — just print it
        await writeOut(ctx, formatEntry(target, stat, flags) + '\n');
        continue;
      }

      let entries = await ctx.vfs.readdirStat(fullPath);

      // Filter hidden files unless -a
      if (!flags.a) {
        entries = entries.filter(e => !e.name.startsWith('.'));
      }

      // Sort
      if (flags.S) entries.sort((a, b) => b.stat.size - a.stat.size);
      else if (flags.t) entries.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());
      else entries.sort((a, b) => a.name.localeCompare(b.name));

      if (flags.r) entries.reverse();

      // Format output
      if (flags.l) {
        // Long format: permissions size date name
        for (const entry of entries) {
          await writeOut(ctx, formatLong(entry.name, entry.stat, flags) + '\n');
        }
      } else if (flags['1']) {
        for (const entry of entries) {
          await writeOut(ctx, entry.name + '\n');
        }
      } else {
        // Columnar output
        await writeOut(ctx, entries.map(e => colorize(e.name, e.stat)).join('  ') + '\n');
      }

      // Recursive
      if (flags.R) {
        for (const entry of entries) {
          if (entry.stat.isDirectory() && entry.name !== '.' && entry.name !== '..') {
            await writeOut(ctx, `\n${fullPath}/${entry.name}:\n`);
            await ls({ ...ctx, args: [...ctx.args, `${fullPath}/${entry.name}`] });
          }
        }
      }
    } catch (err: any) {
      await writeErr(ctx, `ls: cannot access '${target}': ${err.message}\n`);
      return 1;
    }
  }

  return 0;
};

function colorize(name: string, stat: Stat): string {
  if (stat.isDirectory()) return `\x1b[1;34m${name}\x1b[0m`;  // Blue bold
  if (stat.isSymbolicLink()) return `\x1b[1;36m${name}\x1b[0m`; // Cyan
  if (stat.mode & 0o111) return `\x1b[1;32m${name}\x1b[0m`;    // Green (executable)
  return name;
}

export default ls;
```

```typescript
// src/commands/text/grep.ts
// Implements: grep [-i] [-v] [-n] [-c] [-l] [-r] [-E] [-w] pattern [file...]

const grep: Command = async (ctx: CommandContext): Promise<number> => {
  const { flags, positional } = parseArgs(ctx.args, {
    boolean: ['i', 'v', 'n', 'c', 'l', 'r', 'E', 'w'],
    alias: { 'ignore-case': 'i', invert: 'v', 'line-number': 'n',
             count: 'c', 'files-with-matches': 'l', recursive: 'r',
             'extended-regexp': 'E', 'word-regexp': 'w' }
  });

  const pattern = positional[0];
  if (!pattern) {
    await writeErr(ctx, 'grep: missing pattern\n');
    return 2;
  }

  let regexStr = flags.E ? pattern : escapeRegex(pattern);
  if (flags.w) regexStr = `\\b${regexStr}\\b`;
  const regex = new RegExp(regexStr, flags.i ? 'gi' : 'g');

  const files = positional.slice(1);
  let matched = false;

  if (files.length === 0) {
    // Read from stdin
    const input = await readStdin(ctx);
    matched = await grepLines(ctx, input, regex, flags, null);
  } else {
    for (const file of files) {
      // If -r and directory, recurse
      // Otherwise read file and grep
      const content = await ctx.vfs.readFile(ctx.vfs.resolve(ctx.cwd, file));
      const text = new TextDecoder().decode(content);
      const fileMatched = await grepLines(ctx, text, regex, flags, files.length > 1 ? file : null);
      if (fileMatched) matched = true;
    }
  }

  return matched ? 0 : 1;
};

export default grep;
```

```typescript
// src/commands/net/curl.ts
// Implements: curl [-X method] [-H header] [-d data] [-o output] [-s] [-L] [-I] url

const curl: Command = async (ctx: CommandContext): Promise<number> => {
  const { flags, positional } = parseArgs(ctx.args, {
    string: ['X', 'H', 'd', 'o'],
    boolean: ['s', 'L', 'I', 'v'],
    collect: ['H'],  // Multiple -H flags
    alias: { request: 'X', header: 'H', data: 'd', output: 'o',
             silent: 's', location: 'L', head: 'I', verbose: 'v' }
  });

  const url = positional[0];
  if (!url) {
    await writeErr(ctx, 'curl: no URL specified\n');
    return 1;
  }

  try {
    const headers = new Headers();
    if (flags.H) {
      for (const h of (Array.isArray(flags.H) ? flags.H : [flags.H])) {
        const [key, ...val] = h.split(':');
        headers.set(key.trim(), val.join(':').trim());
      }
    }

    const init: RequestInit = {
      method: flags.X || (flags.d ? 'POST' : 'GET'),
      headers,
      redirect: flags.L ? 'follow' : 'manual',
      signal: ctx.signal,
    };

    if (flags.d) init.body = flags.d;
    if (flags.I) init.method = 'HEAD';

    const response = await fetch(url, init);

    // Verbose: print request/response headers
    if (flags.v) {
      await writeErr(ctx, `> ${init.method} ${url}\n`);
      headers.forEach((v, k) => writeErr(ctx, `> ${k}: ${v}\n`));
      await writeErr(ctx, `< HTTP/${response.status} ${response.statusText}\n`);
      response.headers.forEach((v, k) => writeErr(ctx, `< ${k}: ${v}\n`));
      await writeErr(ctx, '\n');
    }

    if (flags.I) {
      // HEAD: print headers only
      response.headers.forEach((v, k) => writeOut(ctx, `${k}: ${v}\n`));
      return 0;
    }

    // Stream response body to stdout or file
    const body = response.body;
    if (!body) return 0;

    if (flags.o) {
      // Write to file
      const data = new Uint8Array(await response.arrayBuffer());
      await ctx.vfs.writeFile(ctx.vfs.resolve(ctx.cwd, flags.o), data);
      if (!flags.s) await writeErr(ctx, `Written to ${flags.o}\n`);
    } else {
      // Stream to stdout
      const reader = body.getReader();
      const writer = ctx.stdout.getWriter();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      writer.releaseLock();
    }

    return 0;
  } catch (err: any) {
    if (!flags.s) await writeErr(ctx, `curl: ${err.message}\n`);
    return 1;
  }
};

export default curl;
```

```typescript
// src/commands/system/top.ts
// Implements: top — real-time process viewer

const top: Command = async (ctx: CommandContext): Promise<number> => {
  const refreshMs = 2000;

  while (!ctx.signal.aborted) {
    // Clear screen
    await writeOut(ctx, '\x1b[2J\x1b[H');

    // Header
    const uptime = (performance.now() / 1000).toFixed(0);
    const mem = (performance as any).memory;
    const cpus = navigator.hardwareConcurrency || 1;

    await writeOut(ctx, `top - up ${formatUptime(Number(uptime))}, ${cpus} CPUs\n`);

    if (mem) {
      const used = (mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
      const total = (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1);
      await writeOut(ctx, `Mem: ${used}M / ${total}M\n`);
    }

    await writeOut(ctx, '\n');

    // Process table
    await writeOut(ctx, `  PID  STATUS     TIME  COMMAND\n`);
    const processes = ctx.processManager.list();
    for (const p of processes) {
      const time = ((performance.now() - p.startTime) / 1000).toFixed(1);
      await writeOut(ctx,
        `${String(p.pid).padStart(5)}  ${p.status.padEnd(9)}  ${time.padStart(5)}s  ${p.name} ${p.args.join(' ')}\n`
      );
    }

    await writeOut(ctx, `\nProcesses: ${processes.length} total\n`);

    // Wait for next refresh or abort
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, refreshMs);
      ctx.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  return 0;
};

export default top;
```

---

## Phase 4: Node.js Compatibility Layer

Node.js is not WASM — it's a thin mapping layer where Node's standard library calls your OS APIs.

### 4.1 Module Mapping

```typescript
// src/node-compat/index.ts
// When a user runs `node script.js`, import resolution maps:
// require('fs')            → import from './fs'
// require('path')          → import from './path'
// require('http')          → import from './http'
// require('child_process') → import from './child_process'
// etc.

export const nodeModules: Record<string, () => Promise<any>> = {
  'fs':              () => import('./fs'),
  'fs/promises':     () => import('./fs'),       // Same module, promise API
  'path':            () => import('./path'),
  'http':            () => import('./http'),
  'https':           () => import('./http'),      // Same, fetch handles both
  'net':             () => import('./net'),
  'stream':          () => import('./stream'),
  'crypto':          () => import('./crypto'),
  'os':              () => import('./os'),
  'child_process':   () => import('./child_process'),
  'events':          () => import('./events'),
  'url':             () => import('./url'),
  'util':            () => import('./util'),
  'buffer':          () => import('./buffer'),
  'process':         () => import('./process'),
  'console':         () => import('./console'),
  'timers':          () => import('./timers'),
  'querystring':     () => import('./url'),       // URL API handles this
};
```

### 4.2 fs Module

```typescript
// src/node-compat/fs.ts
// Maps Node's fs module to the VFS

export function createFsModule(kernel: Kernel) {
  const vfs = kernel.vfs;

  return {
    // Async callbacks (Node classic style)
    readFile(path: string, options: any, callback?: Function) {
      const cb = callback || options;
      const encoding = typeof options === 'string' ? options : options?.encoding;
      vfs.readFile(path).then(data => {
        cb(null, encoding ? new TextDecoder(encoding).decode(data) : data);
      }).catch(err => cb(err));
    },

    writeFile(path: string, data: any, options: any, callback?: Function) {
      const cb = callback || options;
      const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      vfs.writeFile(path, encoded).then(() => cb(null)).catch(err => cb(err));
    },

    readdir(path: string, options: any, callback?: Function) {
      const cb = callback || options;
      vfs.readdir(path).then(entries => cb(null, entries)).catch(err => cb(err));
    },

    stat(path: string, callback: Function) {
      vfs.stat(path).then(stat => callback(null, stat)).catch(err => callback(err));
    },

    mkdir(path: string, options: any, callback?: Function) {
      const cb = callback || options;
      const recursive = typeof options === 'object' && options?.recursive;
      vfs.mkdir(path, { recursive }).then(() => cb(null)).catch(err => cb(err));
    },

    existsSync(path: string): boolean {
      // Synchronous check — uses cached FS state
      return vfs.existsSync(path);
    },

    // Promise API (fs/promises)
    promises: {
      readFile:  (path: string, options?: any) => vfs.readFile(path).then(data =>
                   options?.encoding ? new TextDecoder(options.encoding).decode(data) : data),
      writeFile: (path: string, data: any) => vfs.writeFile(path,
                   typeof data === 'string' ? new TextEncoder().encode(data) : data),
      readdir:   (path: string) => vfs.readdir(path),
      stat:      (path: string) => vfs.stat(path),
      mkdir:     (path: string, options?: any) => vfs.mkdir(path, options),
      rm:        (path: string, options?: any) => options?.recursive
                   ? vfs.rmRecursive(path) : vfs.unlink(path),
      rename:    (old: string, new_: string) => vfs.rename(old, new_),
      access:    (path: string) => vfs.stat(path).then(() => {}),
      // ... all other fs.promises methods
    },

    // Streams
    createReadStream(path: string, options?: any): ReadableStream {
      // Return a ReadableStream that reads from VFS
      return new ReadableStream({
        async start(controller) {
          const data = await vfs.readFile(path);
          controller.enqueue(data);
          controller.close();
        }
      });
    },

    createWriteStream(path: string, options?: any): WritableStream {
      return new WritableStream({
        async write(chunk) { await vfs.appendFile(path, chunk); },
        async close() { /* finalize */ }
      });
    },
  };
}
```

### 4.3 child_process Module

```typescript
// src/node-compat/child_process.ts

export function createChildProcessModule(kernel: Kernel) {
  return {
    exec(command: string, options: any, callback?: Function) {
      const cb = callback || options;
      // Parse command through the shell, capture stdout/stderr
      kernel.shell.exec(command).then(result => {
        cb(null, result.stdout, result.stderr);
      }).catch(err => cb(err));
    },

    spawn(command: string, args: string[], options?: any) {
      // Spawn a new process via ProcessManager
      // Returns an object with stdin, stdout, stderr streams and a pid
      const proc = kernel.processManager.spawn({
        name: command,
        args,
        env: options?.env || kernel.shell.env,
        cwd: options?.cwd || kernel.shell.cwd,
      });
      return proc;
    },

    execSync(command: string, options?: any): string {
      // Synchronous exec — uses Atomics.wait if possible
      // Fallback: throw error recommending async version
      throw new Error('execSync is not supported in BrowserOS. Use exec() or spawn() instead.');
    },

    fork(modulePath: string, args?: string[], options?: any) {
      // Fork spawns a new Worker running the given script
      return kernel.processManager.spawn({
        name: 'node',
        args: [modulePath, ...(args || [])],
        env: options?.env || kernel.shell.env,
        cwd: options?.cwd || kernel.shell.cwd,
      });
    },
  };
}
```

### 4.4 os Module

```typescript
// src/node-compat/os.ts

export function createOsModule() {
  return {
    arch: () => 'wasm',           // We run on WASM/browser
    platform: () => 'browser',
    type: () => 'BrowserOS',
    release: () => '1.0.0',
    hostname: () => location.hostname || 'localhost',
    homedir: () => '/home/user',
    tmpdir: () => '/tmp',
    cpus: () => Array.from({ length: navigator.hardwareConcurrency || 1 }, () => ({
      model: 'Browser Virtual CPU',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    })),
    totalmem: () => (performance as any).memory?.jsHeapSizeLimit || 0,
    freemem: () => {
      const mem = (performance as any).memory;
      return mem ? mem.jsHeapSizeLimit - mem.usedJSHeapSize : 0;
    },
    uptime: () => performance.now() / 1000,
    userInfo: () => ({ username: 'user', uid: 1000, gid: 1000, shell: '/bin/sh', homedir: '/home/user' }),
    networkInterfaces: () => ({}),
    EOL: '\n',
  };
}
```

---

## Phase 5: Terminal UI

### 5.1 Terminal Setup

```typescript
// src/terminal/Terminal.ts

import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';

export class TerminalUI {
  private xterm: XTerm;
  private fitAddon: FitAddon;

  constructor(container: HTMLElement) {
    this.xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);

    try {
      this.xterm.loadAddon(new WebglAddon());
    } catch {
      // Fallback to canvas renderer
    }

    this.xterm.open(container);
    this.fitAddon.fit();

    window.addEventListener('resize', () => this.fitAddon.fit());
  }

  // Write to terminal display
  write(data: string): void { this.xterm.write(data); }

  // Handle user input
  onData(callback: (data: string) => void): void { this.xterm.onData(callback); }

  // Handle resize
  onResize(callback: (cols: number, rows: number) => void): void {
    this.xterm.onResize(({ cols, rows }) => callback(cols, rows));
  }

  get cols(): number { return this.xterm.cols; }
  get rows(): number { return this.xterm.rows; }
}
```

### 5.2 Prompt

```
user@browseros:~$ _
```

The prompt is configurable via `$PS1`:
- Default: `\u@\h:\w\$ ` which expands to `user@browseros:~/path$ `
- `\u` = username, `\h` = hostname, `\w` = working directory, `\$` = $ (or # for root)

---

## Phase 6: Boot Sequence

```typescript
// src/main.ts

import { Kernel } from './kernel';
import { TerminalUI } from './terminal/Terminal';
import { Shell } from './shell/Shell';

async function boot() {
  // Phase 1: Initialize kernel subsystems
  const kernel = new Kernel();

  // Phase 2: Mount filesystems
  await kernel.vfs.mount('/', new MemoryBackend());
  await kernel.vfs.mount('/home', new OPFSBackend('home'));
  await kernel.vfs.mount('/tmp', new MemoryBackend());
  await kernel.vfs.mount('/proc', new ProcFS(kernel));
  await kernel.vfs.mount('/dev', new DevFS(kernel.deviceManager));

  // Phase 3: Initialize directory structure
  await kernel.initFilesystem();  // Creates /home/user, /etc, /var, etc.

  // Phase 4: Load system config
  await kernel.loadConfig();      // Reads /etc/profile, /etc/hostname, /etc/motd

  // Phase 5: Register devices
  kernel.deviceManager.register('null', new NullDevice());
  kernel.deviceManager.register('zero', new ZeroDevice());
  kernel.deviceManager.register('random', new RandomDevice());
  kernel.deviceManager.register('urandom', new RandomDevice());
  kernel.deviceManager.register('clipboard', new ClipboardDevice());
  kernel.deviceManager.register('speaker', new AudioDevice());
  // ... more devices

  // Phase 6: Initialize terminal
  const container = document.getElementById('terminal')!;
  const terminal = new TerminalUI(container);

  // Phase 7: Start shell (PID 1)
  const shell = new Shell(kernel, terminal);

  // Display MOTD
  const motd = await kernel.vfs.readFile('/etc/motd').catch(() => null);
  if (motd) terminal.write(new TextDecoder().decode(motd) + '\n');

  // Phase 8: Source user profile
  await shell.source('/etc/profile');
  await shell.source('/home/user/.bashrc').catch(() => {});

  // Phase 9: Show prompt, ready for input
  shell.prompt();

  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', boot);
```

---

## Phase 7: Package Manager

### 7.1 Package Format

```json
{
  "name": "ripgrep",
  "version": "1.0.0",
  "description": "Fast text search (rg command)",
  "commands": {
    "rg": "./rg.js"
  },
  "dependencies": {},
  "type": "esm",
  "main": "./rg.js"
}
```

### 7.2 Package Manager CLI

```
pkg install <name>          # Install from registry
pkg remove <name>           # Uninstall
pkg list                    # List installed packages
pkg search <query>          # Search registry
pkg update [name]           # Update packages
pkg publish                 # Publish to registry (future)
pkg info <name>             # Show package details
```

### 7.3 Well-Known Packages

These are optional, loaded on demand:

| Package Name | Provides | Backed By |
|---|---|---|
| python | `python`, `python3` commands | Pyodide (WASM) |
| sqlite | `sqlite3` command | sql.js (WASM) |
| lua | `lua` command | Fengari or WASM build |
| vim | `vim` command | vim.wasm or JS port |
| nano | `nano` command | JS implementation |
| jq | `jq` command | JS implementation |
| ffmpeg | `ffmpeg` command | ffmpeg.wasm |
| imagemagick | `convert`, `identify` commands | WASM build |
| git | `git` command | isomorphic-git |
| make | `make` command | JS implementation |
| less | `less` command | JS pager |

---

## Phase 8: Key Implementation Notes

### Async Everything

The browser is async. Every VFS operation, every device read, every process spawn is async. The shell interpreter must be fully async:

```typescript
// Every command is async
async function interpret(ast: ASTNode): Promise<number> {
  // Even a simple `ls | grep foo` requires:
  // 1. Spawn ls (async)
  // 2. Create pipe (sync)
  // 3. Spawn grep (async)
  // 4. Wait for both to complete (async)
  // 5. Return exit code
}
```

### Streams Are Pipes

The Web Streams API IS the Unix pipe model:

```typescript
// ls | grep foo | wc -l
// Translates DIRECTLY to:
const [r1, w1] = createPipe();
const [r2, w2] = createPipe();
spawn('ls', { stdout: w1 });
spawn('grep', { stdin: r1, stdout: w2, args: ['foo'] });
spawn('wc', { stdin: r2, stdout: terminal, args: ['-l'] });
```

### ANSI Color Support

All commands should output ANSI escape codes for color. xterm.js handles rendering. Use the colors utility:

```typescript
// src/utils/colors.ts
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};
```

### Error Handling Convention

Follow Unix conventions:
- Exit code `0` = success
- Exit code `1` = general error
- Exit code `2` = misuse (wrong args)
- Exit code `126` = permission denied
- Exit code `127` = command not found
- Exit code `130` = killed by SIGINT (Ctrl+C)

Error messages go to stderr, never stdout:

```typescript
await writeErr(ctx, `command: error message\n`);
return 1;
```

### Argument Parser

Provide a `parseArgs` utility matching POSIX getopt behavior:

```typescript
// src/utils/args.ts
export function parseArgs(args: string[], spec: {
  boolean?: string[];    // Flags that take no value
  string?: string[];     // Flags that take a value
  alias?: Record<string, string>;  // Long → short aliases
  collect?: string[];    // Flags that can appear multiple times
  default?: Record<string, any>;
}): {
  flags: Record<string, any>;
  positional: string[];
  rest: string[];        // Everything after --
};
```

Supports:
- `-f` (short boolean)
- `-f value` (short with value)
- `-fvalue` (short combined)
- `--flag` (long boolean)
- `--flag=value` (long with value)
- `--` (stop parsing)
- `-abc` → `-a -b -c` (combined short booleans)

---

## Phase 9: Testing Strategy

### Unit Tests

Every layer should have unit tests:

```typescript
// tests/kernel/vfs.test.ts
describe('VFS', () => {
  it('should create and read files', async () => {
    const vfs = new VFS();
    await vfs.mount('/', new MemoryBackend());
    await vfs.writeFile('/test.txt', encode('hello'));
    const data = await vfs.readFile('/test.txt');
    expect(decode(data)).toBe('hello');
  });

  it('should handle directory operations', async () => { ... });
  it('should resolve symlinks', async () => { ... });
  it('should enforce permissions', async () => { ... });
  it('should handle mount points', async () => { ... });
});

// tests/shell/parser.test.ts
describe('Shell Parser', () => {
  it('should parse simple commands', () => {
    expect(parse('ls -la')).toMatchObject({
      type: 'simple_command', name: 'ls', args: ['-la']
    });
  });

  it('should parse pipes', () => { ... });
  it('should parse redirections', () => { ... });
  it('should parse && and ||', () => { ... });
  it('should parse for loops', () => { ... });
  it('should handle quoting', () => { ... });
  it('should expand variables', () => { ... });
});
```

### Integration Tests

Test full command pipelines:

```typescript
describe('Command Integration', () => {
  it('should pipe ls into grep', async () => {
    await vfs.writeFile('/tmp/a.txt', encode(''));
    await vfs.writeFile('/tmp/b.log', encode(''));
    const result = await shell.exec('ls /tmp | grep .txt');
    expect(result.stdout).toBe('a.txt\n');
  });

  it('should redirect output to file', async () => {
    await shell.exec('echo "hello world" > /tmp/out.txt');
    const data = await vfs.readFile('/tmp/out.txt');
    expect(decode(data)).toBe('hello world\n');
  });
});
```

---

## Build Order (Recommended)

Build in this order — each phase builds on the previous:

### Sprint 1: Foundation (Week 1-2)
1. Project setup (Vite + TypeScript + xterm.js)
2. VFS with MemoryBackend (in-memory filesystem)
3. Basic shell (read line → parse → execute → print)
4. 10 essential commands: `ls`, `cat`, `echo`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `touch`
5. Boot sequence that shows a terminal with a working prompt

### Sprint 2: Shell Features (Week 3-4)
6. Full lexer/parser (pipes, redirects, &&, ||, ;, &)
7. Variable expansion ($VAR, ${VAR})
8. Command substitution $(...)
9. Glob expansion (*.txt)
10. Tab completion
11. Command history
12. Job control (Ctrl+C, &, fg, bg)

### Sprint 3: Coreutils (Week 5-6)
13. Text processing: `grep`, `sed`, `awk`, `head`, `tail`, `sort`, `uniq`, `wc`, `cut`, `tr`
14. File utilities: `find`, `tree`, `stat`, `ln`, `du`, `df`, `chmod`, `file`
15. I/O: `tee`, `xargs`, `yes`, `printf`
16. System: `ps`, `top`, `kill`, `env`, `uname`, `date`, `sleep`, `uptime`, `free`

### Sprint 4: Persistence & Devices (Week 7-8)
17. OPFS backend (persistent filesystem)
18. /proc virtual filesystem
19. /dev virtual devices (null, zero, random, clipboard, speaker)
20. .bashrc and profile loading
21. Network commands: `curl`, `wget`, `ping`, `dig`

### Sprint 5: Node Compat & Packages (Week 9-10)
22. Node.js compatibility layer (fs, path, http, child_process, os)
23. `node` command that runs JS files with Node compat
24. Package manager (`pkg install/remove/list`)
25. Archive commands: `tar`, `gzip`, `zip`

### Sprint 6: Polish & Advanced (Week 11-12)
26. Shell scripting (if/else, for, while, case, functions)
27. Service Worker for offline support
28. Additional mount backends (File System Access API for local disk)
29. Man pages / help system
30. Full test suite
31. Performance optimization

---

## Environment Variables (Defaults)

```bash
HOME=/home/user
USER=user
SHELL=/bin/sh
PATH=/usr/bin:/bin
PWD=/home/user
TERM=xterm-256color
LANG=en_US.UTF-8
HOSTNAME=browseros
EDITOR=nano
BROWSER_OS_VERSION=1.0.0
```

---

## Default .bashrc

```bash
# ~/.bashrc - BrowserOS user shell config

# Prompt
PS1='\[\033[1;32m\]\u@\h\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]\$ '

# Aliases
alias ll='ls -la'
alias la='ls -a'
alias l='ls -1'
alias ..='cd ..'
alias ...='cd ../..'
alias grep='grep --color=auto'
alias cls='clear'
alias h='history'
alias q='exit'

# Environment
export EDITOR=nano
export PAGER=less
```

---

## Default /etc/motd

```
 ____                                 ___  ____
| __ ) _ __ _____      _____  ___ _ / _ \/ ___|
|  _ \| '__/ _ \ \ /\ / / __|/ _ \ | | | \___ \
| |_) | | | (_) \ V  V /\__ \  __/ | |_| |___) |
|____/|_|  \___/ \_/\_/ |___/\___|  \___/|____/

Welcome to BrowserOS v1.0.0
Type 'help' for available commands.
```

---

## Performance Targets

| Metric | Target |
|---|---|
| Cold boot (first load) | < 200ms to shell prompt |
| Warm boot (cached) | < 50ms to shell prompt |
| Command execution (simple) | < 5ms |
| Command execution (complex pipe) | < 50ms |
| File read (< 1MB) | < 10ms |
| File write (< 1MB) | < 20ms |
| Tab completion | < 20ms |
| Bundle size (gzipped) | < 600KB |
| Memory (idle) | < 20MB |
| Memory (typical session) | < 80MB |

---

## Implementation Status

*Last updated: 2026-02-22 (after Sprint 5)*

### Sprint Progress

| Sprint | Status | Summary |
|--------|--------|---------|
| Sprint 1: Foundation | **Done** | VFS, shell, 10 core commands, boot sequence |
| Sprint 2: Shell Features | **Done** | Pipes, redirects, `&&`/`||`, `&`, `$(...)`, globs, tab completion, history, job control |
| Sprint 3: Coreutils | **Partial** | 28/38 planned commands implemented |
| Sprint 4: Persistence & Devices | **Done** | IndexedDB persistence, /proc, /dev, `.bashrc`/`profile`, 4 network commands |
| Sprint 5: Node Compat & Packages | **Done** | 17 Node.js modules, `node` command, `pkg` manager, 5 archive commands |
| Sprint 6: Polish & Advanced | **Not started** | Shell scripting, service worker, mount backends, man pages |

### Commands: 55 total (43 external + 12 shell builtins)

**Shell builtins (12):** `cd`, `pwd`, `echo`, `clear`, `export`, `exit`, `true`, `false`, `source`/`.`, `alias`, `unalias`, `history`, `jobs`, `fg`, `bg`

**External commands (43):**

| Category | Implemented | Missing |
|----------|-------------|---------|
| Filesystem (14/20) | `ls` `cat` `mkdir` `rm` `cp` `mv` `touch` `find` `tree` `stat` `ln` `du` `df` `chmod` `file` | `rmdir` `chown` `realpath` `basename` `dirname` `mktemp` |
| Text (10/16) | `grep` `head` `tail` `wc` `sort` `uniq` `cut` `tr` `sed` `awk` | `diff` `paste` `fold` `nl` `rev` `fmt` |
| I/O (4/5) | `tee` `xargs` `yes` `printf` | `read` (as external; shell builtin exists) |
| System (9/19) | `env` `uname` `date` `sleep` `uptime` `whoami` `hostname` `free` `which` | `ps` `top` `kill` `watch` `cal` `bc` `type` `man` `help` |
| Network (4/5) | `curl` `wget` `ping` `dig` | `nc` |
| Archive (5/5) | `tar` `gzip` `gunzip` `zip` `unzip` | -- |
| Node/Pkg (2/2) | `node` `pkg` | -- |

### Node.js Compatibility Layer: 17/19 modules

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | **Done** | Sync + callback + promises API over VFS |
| `path` | **Done** | Wrapper over `src/utils/path.ts` + `relative`/`parse`/`format` |
| `os` | **Done** | `hostname`, `homedir`, `cpus`, `totalmem`, `freemem`, etc. |
| `process` | **Done** | `argv`, `env`, `cwd()`, `exit()` (throws `ProcessExitError`), `hrtime` |
| `events` | **Done** | Full `EventEmitter`: `on`/`once`/`emit`/`off`/`removeAllListeners` |
| `buffer` | **Done** | `Buffer` extending `Uint8Array`, `from`/`alloc`/`concat`/`toString(hex/base64)` |
| `util` | **Done** | `format(%s/%d/%j/%o)`, `inspect`, `promisify` |
| `console` | **Done** | `log`/`warn`/`error`/`info`/`debug`/`time`/`timeEnd` |
| `http` / `https` | **Done** | `get()`/`request()` via `fetch()`. `createServer()` throws "not supported" |
| `child_process` | **Done** | `exec()` via interpreter. `execSync()`/`spawn()`/`fork()` throw |
| `stream` | **Done** | Minimal `Readable`/`Writable`/`Duplex`/`PassThrough` |
| `url` | **Done** | Re-exports `URL`/`URLSearchParams` + legacy `parse()`/`format()` |
| `timers` | **Done** | `setTimeout`/`setInterval` + `setImmediate` shim |
| `crypto` | **Done** | `randomBytes()` via Web Crypto, `createHash()` via SubtleCrypto (async digest) |
| `querystring` | **Done** | `parse`/`stringify` via `URLSearchParams` |
| `assert` | **Done** | `ok`/`equal`/`strictEqual`/`deepStrictEqual`/`throws` |
| `net` | **Not done** | Socket-level networking (would need WebSocket/WebRTC) |
| `module` | **Not done** | `require()` bridge (node command has its own inline require) |

### Kernel Architecture: Simplified vs plan

The actual implementation is deliberately simpler than the original plan. Commands run as async functions on the main thread (not Web Workers), VFS is synchronous in-memory, and there's no fd abstraction. This is a pragmatic trade-off -- it keeps the codebase simple and fast while still being functional.

| Feature | Plan | Actual | Gap |
|---------|------|--------|-----|
| VFS | 3 backends (Memory, OPFS, IndexedDB) | Single in-memory INode tree | One backend, persistence via IndexedDB serialization |
| Processes | Web Workers + PID table + spawn/kill/wait | Async functions on main thread | No `ps`/`top`/`kill` support |
| Signals | Full POSIX (SIGINT, SIGTERM, SIGKILL...) | `AbortController` for Ctrl+C | Sufficient for commands |
| File descriptors | Full fd table (0/1/2/open/close) | `CommandOutputStream` string-only | No binary piping |
| Mount system | `mount`/`umount` with pluggable backends | Hardcoded virtual providers (`/proc`, `/dev`) | No dynamic mounts |
| Symlinks | Full resolution in VFS | `ln -s` creates but no transparent resolution | Symlinks are stored but not followed |
| Devices | 12+ (audio, camera, USB, BT, serial, gamepad, MIDI) | 5 (null, zero, random, urandom, clipboard) | Missing hardware API devices |

### Shell: Pipes & redirects work, scripting not yet

| Feature | Status |
|---------|--------|
| Simple commands | **Done** |
| Pipes (`\|`) | **Done** |
| Redirects (`>`, `>>`, `<`, `2>`, `2>>`, `&>`) | **Done** |
| Logical operators (`&&`, `\|\|`) | **Done** |
| Background execution (`&`) | **Done** |
| Semicolon chaining (`;`) | **Done** |
| Variable expansion (`$VAR`) | **Done** |
| Command substitution (`$(...)`) | **Done** |
| Glob expansion (`*.txt`, `?`, `[abc]`) | **Done** |
| Tilde expansion (`~`) | **Done** |
| Tab completion | **Done** |
| Command history (up/down) | **Done** |
| Job control (`jobs`, `fg`, `bg`, Ctrl+C, Ctrl+Z) | **Done** |
| `source` / `.` | **Done** |
| `alias` / `unalias` | **Done** |
| `if`/`then`/`elif`/`else`/`fi` | **Not done** |
| `for`/`do`/`done` | **Not done** |
| `while`/`until`/`do`/`done` | **Not done** |
| `case`/`in`/`esac` | **Not done** |
| Function definitions `foo() { ... }` | **Not done** |
| Brace expansion `{a,b,c}` | **Not done** |
| Arithmetic expansion `$((expr))` | **Not done** |
| Here documents `<<EOF` | **Not done** |
| Here strings `<<<` | **Not done** |
| Advanced parameter expansion `${VAR:-default}` | **Not done** |

### Package Manager: Basic URL-based install

| Feature | Status |
|---------|--------|
| `pkg install <url> [name]` | **Done** |
| `pkg remove <name>` | **Done** |
| `pkg list` | **Done** |
| `pkg info <name>` | **Done** |
| Boot-time re-registration | **Done** |
| `pkg search <query>` | **Not done** (no registry) |
| `pkg update [name]` | **Not done** |
| `pkg publish` | **Not done** |
| Registry client | **Not done** |
| Dependency resolution | **Not done** |

### Test Coverage: 365 tests across 21 test files

All tests pass. Coverage spans VFS, shell (lexer, parser, source/alias), commands (fs, text, io, system, net, archive, node, pkg), node-compat (events, buffer, fs, path), utilities (path, archive), and persistence.

---

## What's Next: Sprint 6+ Roadmap

### Sprint 6a: Missing Coreutils
- System commands: `ps`, `top`, `kill`, `watch`, `cal`, `bc`, `man`, `help`
- Filesystem: `rmdir`, `realpath`, `basename`, `dirname`, `mktemp`, `chown`
- Text processing: `diff`, `nl`, `rev`

### Sprint 6b: Shell Scripting
- `if`/`then`/`elif`/`else`/`fi`
- `for`/`do`/`done`
- `while`/`until`/`do`/`done`
- `case`/`in`/`esac`
- Function definitions
- Arithmetic expansion `$((expr))`
- Advanced parameter expansion `${VAR:-default}`, `${VAR#prefix}`, `${#VAR}`

### Sprint 7: Process Model & Advanced Kernel
- Process manager (track commands as processes with PIDs)
- `ps`, `top`, `kill` commands using process manager
- Proper signal handling beyond AbortController
- Symlink resolution in VFS

### Sprint 8: Polish
- Service worker for offline support
- Additional mount backends (File System Access API)
- Man pages / help system
- Theme switching
- Custom keybindings
- `nc` (netcat via WebSocket)
- Additional devices (speaker, mic, camera)

---

## Summary

This document specifies a complete browser-native Linux-like OS. The key insight is that the browser already provides the kernel -- we are building the Unix userspace on top. The Web Streams API is Unix pipes. OPFS is the disk. Web Workers are processes. Browser device APIs are `/dev/*`. fetch() is the network stack.

Build it layer by layer: VFS -> Process Manager -> Shell -> Commands -> Node Compat -> Packages. Each layer has a clean interface that the layer above depends on. Keep commands lazy-loaded so the core stays under 600KB. Make the shell feel snappy -- command execution should be near-instant.

The result should feel like opening a real terminal on a real Linux machine -- except it's in the browser, boots in milliseconds, and can access every browser API through the Unix interface.
