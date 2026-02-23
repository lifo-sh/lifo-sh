import type { CommandOutputStream } from '../commands/types.js';

export class ProcessExitError extends Error {
  exitCode: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
    this.exitCode = code;
  }
}

export interface ProcessOptions {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  stdout: CommandOutputStream;
  stderr: CommandOutputStream;
}

export function createProcess(opts: ProcessOptions) {
  const startTime = Date.now();

  return {
    argv: ['/usr/bin/node', ...opts.argv],
    argv0: 'node',
    env: { ...opts.env },
    cwd: () => opts.cwd,
    chdir: (_dir: string) => { throw new Error('process.chdir() is not supported in Lifo'); },
    exit: (code = 0) => { throw new ProcessExitError(code); },
    stdout: {
      write: (data: string) => { opts.stdout.write(data); return true; },
      isTTY: false,
    },
    stderr: {
      write: (data: string) => { opts.stderr.write(data); return true; },
      isTTY: false,
    },
    stdin: {
      isTTY: false,
    },
    platform: 'lifo' as const,
    arch: 'wasm' as const,
    version: 'v20.0.0',
    versions: {
      node: '20.0.0',
      lifo: '0.1.0',
    },
    pid: 1,
    ppid: 0,
    title: 'node',
    execPath: '/usr/bin/node',
    hrtime: Object.assign(
      (prev?: [number, number]): [number, number] => {
        const now = performance.now();
        const sec = Math.floor(now / 1000);
        const nano = Math.floor((now % 1000) * 1e6);
        if (prev) {
          let ds = sec - prev[0];
          let dn = nano - prev[1];
          if (dn < 0) { ds--; dn += 1e9; }
          return [ds, dn];
        }
        return [sec, nano];
      },
      {
        bigint: (): bigint => BigInt(Math.floor(performance.now() * 1e6)),
      },
    ),
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      queueMicrotask(() => fn(...args));
    },
    memoryUsage: () => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      return {
        rss: m?.usedJSHeapSize ?? 0,
        heapTotal: m?.totalJSHeapSize ?? 0,
        heapUsed: m?.usedJSHeapSize ?? 0,
        external: 0,
        arrayBuffers: 0,
      };
    },
    uptime: () => (Date.now() - startTime) / 1000,
    release: { name: 'node' },
    config: {},
    emitWarning: (msg: string) => { opts.stderr.write(`Warning: ${msg}\n`); },
  };
}
