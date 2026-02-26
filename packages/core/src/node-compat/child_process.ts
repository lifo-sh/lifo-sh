import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';

type ExecuteCapture = (input: string) => Promise<string>;

// ─── ChildProcess class (spawn result) ───

class ChildProcess extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  connected = true;

  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  stdio: [Writable, Readable, Readable];

  private _executeCapture?: ExecuteCapture;
  private _cmd: string;
  private _args: string[];

  constructor(cmd: string, args: string[], executeCapture?: ExecuteCapture) {
    super();
    this._cmd = cmd;
    this._args = args;
    this._executeCapture = executeCapture;

    this.pid = Math.floor(Math.random() * 30000) + 1000;

    this.stdin = new Writable();
    this.stdout = new Readable();
    this.stderr = new Readable();
    this.stdio = [this.stdin, this.stdout, this.stderr];
  }

  kill(_signal?: string): boolean {
    this.killed = true;
    this.signalCode = _signal || 'SIGTERM';
    this.emit('close', 1, this.signalCode);
    this.emit('exit', 1, this.signalCode);
    return true;
  }

  ref(): this { return this; }
  unref(): this { return this; }
  disconnect(): void { this.connected = false; }

  /** Internal: run the command via Lifo shell */
  _run(): void {
    if (!this._executeCapture) {
      queueMicrotask(() => {
        const err = new Error('child_process.spawn() requires shell interpreter');
        this.emit('error', err);
        this.exitCode = 1;
        this.emit('close', 1, null);
        this.emit('exit', 1, null);
      });
      return;
    }

    const fullCmd = this._args.length > 0
      ? `${this._cmd} ${this._args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`
      : this._cmd;

    const run = this._executeCapture;

    queueMicrotask(async () => {
      try {
        const output = await run(fullCmd);
        this.stdout.push(output);
        this.stdout.push(null);
        this.stderr.push(null);
        this.exitCode = 0;
        this.emit('close', 0, null);
        this.emit('exit', 0, null);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this.stderr.push(errMsg);
        this.stderr.push(null);
        this.stdout.push(null);
        this.exitCode = 1;
        this.emit('close', 1, null);
        this.emit('exit', 1, null);
      }
    });
  }
}

// ─── Factory ───

export function createChildProcess(executeCapture?: ExecuteCapture) {
  function exec(
    cmd: string,
    optionsOrCb?: Record<string, unknown> | ((err: Error | null, stdout: string, stderr: string) => void),
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ): ChildProcess {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;
    const child = new ChildProcess(cmd, [], executeCapture);

    if (!executeCapture) {
      queueMicrotask(() => {
        const err = new Error('child_process.exec() requires shell interpreter');
        if (callback) callback(err, '', '');
        child.emit('error', err);
      });
      return child;
    }

    const run = executeCapture;
    queueMicrotask(async () => {
      try {
        const output = await run(cmd);
        child.stdout.push(output);
        child.stdout.push(null);
        child.stderr.push(null);
        child.exitCode = 0;
        if (callback) callback(null, output, '');
        child.emit('close', 0, null);
        child.emit('exit', 0, null);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        child.stderr.push(err.message);
        child.stderr.push(null);
        child.stdout.push(null);
        child.exitCode = 1;
        if (callback) callback(err, '', err.message);
        child.emit('close', 1, null);
        child.emit('exit', 1, null);
      }
    });

    return child;
  }

  function execFile(
    file: string,
    argsOrCb?: string[] | ((err: Error | null, stdout: string, stderr: string) => void),
    optionsOrCb?: Record<string, unknown> | ((err: Error | null, stdout: string, stderr: string) => void),
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ): ChildProcess {
    let args: string[] = [];
    let callback: ((err: Error | null, stdout: string, stderr: string) => void) | undefined;

    if (typeof argsOrCb === 'function') {
      callback = argsOrCb;
    } else if (Array.isArray(argsOrCb)) {
      args = argsOrCb;
      if (typeof optionsOrCb === 'function') {
        callback = optionsOrCb;
      } else {
        callback = cb;
      }
    }

    const fullCmd = args.length > 0
      ? `${file} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`
      : file;

    return exec(fullCmd, callback);
  }

  function execSync(cmd: string, options?: Record<string, unknown>): string | Uint8Array {
    // In browser, we can't truly block. Throw a descriptive error.
    // Libraries that call execSync in optional/fallback paths will catch this.
    throw Object.assign(
      new Error(`child_process.execSync() cannot block in browser. Command: ${cmd}`),
      { status: 1, stderr: 'Not supported in Lifo browser environment' },
    );
  }

  function execFileSync(file: string, args?: string[], _options?: Record<string, unknown>): string | Uint8Array {
    const cmd = args ? `${file} ${args.join(' ')}` : file;
    return execSync(cmd);
  }

  function spawn(
    cmd: string,
    argsOrOptions?: string[] | Record<string, unknown>,
    options?: Record<string, unknown>,
  ): ChildProcess {
    let args: string[] = [];

    if (Array.isArray(argsOrOptions)) {
      args = argsOrOptions;
    } else if (argsOrOptions && typeof argsOrOptions === 'object') {
      options = argsOrOptions;
    }

    // Handle shell option
    const useShell = options?.shell;
    const child = new ChildProcess(cmd, args, executeCapture);

    if (useShell && typeof useShell === 'string') {
      // When shell is specified, wrap in shell execution
      const fullCmd = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;
      const shellChild = new ChildProcess(fullCmd, [], executeCapture);
      shellChild._run();
      return shellChild;
    }

    child._run();
    return child;
  }

  function spawnSync(
    cmd: string,
    args?: string[],
    _options?: Record<string, unknown>,
  ): { status: number; stdout: Uint8Array; stderr: Uint8Array; error?: Error } {
    const fullCmd = args ? `${cmd} ${args.join(' ')}` : cmd;
    return {
      status: 1,
      stdout: new TextEncoder().encode(''),
      stderr: new TextEncoder().encode(`spawnSync not supported in browser: ${fullCmd}`),
      error: new Error(`child_process.spawnSync() cannot block in browser. Command: ${fullCmd}`),
    };
  }

  function fork(_modulePath: string, _args?: string[], _options?: Record<string, unknown>): ChildProcess {
    const child = new ChildProcess(_modulePath, _args || [], undefined);
    queueMicrotask(() => {
      child.emit('error', new Error('child_process.fork() is not supported in Lifo'));
      child.emit('close', 1, null);
      child.emit('exit', 1, null);
    });
    return child;
  }

  return {
    exec,
    execFile,
    execSync,
    execFileSync,
    spawn,
    spawnSync,
    fork,
    ChildProcess,
  };
}
