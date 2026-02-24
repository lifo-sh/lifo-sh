import type { VFS } from '../kernel/vfs/index.js';
import type { CommandOutputStream } from '../commands/types.js';
import { createFs } from './fs.js';
import pathModule from './path.js';
import { createOs } from './os.js';
import { createProcess } from './process.js';
import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';
import * as utilModule from './util.js';
import { createHttp } from './http.js';
import type { VirtualRequestHandler } from '../kernel/index.js';
import { createChildProcess } from './child_process.js';
import * as streamModule from './stream.js';
import * as urlModule from './url.js';
import * as timersModule from './timers.js';
import * as cryptoModule from './crypto.js';
import * as zlibModule from './zlib.js';
import * as stringDecoderModule from './string_decoder.js';

export interface NodeContext {
  vfs: VFS;
  cwd: string;
  env: Record<string, string>;
  stdout: CommandOutputStream;
  stderr: CommandOutputStream;
  argv: string[];
  filename: string;
  dirname: string;
  signal: AbortSignal;
  executeCapture?: (input: string) => Promise<string>;
  portRegistry?: Map<number, VirtualRequestHandler>;
}

export function createModuleMap(ctx: NodeContext): Record<string, () => unknown> {
  return {
    fs: () => createFs(ctx.vfs, ctx.cwd),
    'fs/promises': () => createFs(ctx.vfs, ctx.cwd).promises,
    path: () => pathModule,
    os: () => createOs(ctx.env),
    process: () => createProcess({
      argv: ctx.argv,
      env: ctx.env,
      cwd: ctx.cwd,
      stdout: ctx.stdout,
      stderr: ctx.stderr,
    }),
    events: () => ({ EventEmitter, default: EventEmitter }),
    buffer: () => ({ Buffer }),
    util: () => utilModule,
    http: () => createHttp(ctx.portRegistry),
    https: () => createHttp(ctx.portRegistry),
    child_process: () => createChildProcess(ctx.executeCapture),
    stream: () => streamModule,
    url: () => urlModule,
    timers: () => timersModule,
    crypto: () => cryptoModule,
    zlib: () => zlibModule,
    string_decoder: () => stringDecoderModule,
    querystring: () => ({
      parse: (str: string) => Object.fromEntries(new URLSearchParams(str)),
      stringify: (obj: Record<string, string>) => new URLSearchParams(obj).toString(),
      escape: encodeURIComponent,
      unescape: decodeURIComponent,
    }),
    assert: () => {
      const assert = (value: unknown, message?: string) => {
        if (!value) throw new Error(message || 'AssertionError');
      };
      assert.ok = assert;
      assert.equal = (a: unknown, b: unknown, msg?: string) => { if (a != b) throw new Error(msg || `${a} != ${b}`); };
      assert.strictEqual = (a: unknown, b: unknown, msg?: string) => { if (a !== b) throw new Error(msg || `${a} !== ${b}`); };
      assert.notEqual = (a: unknown, b: unknown, msg?: string) => { if (a == b) throw new Error(msg || `${a} == ${b}`); };
      assert.notStrictEqual = (a: unknown, b: unknown, msg?: string) => { if (a === b) throw new Error(msg || `${a} === ${b}`); };
      assert.deepStrictEqual = (a: unknown, b: unknown, msg?: string) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'deepStrictEqual failed');
      };
      assert.throws = (fn: () => void, msg?: string) => {
        try { fn(); throw new Error(msg || 'Expected function to throw'); } catch (e) { if (e instanceof Error && e.message === (msg || 'Expected function to throw')) throw e; }
      };
      return assert;
    },
  };
}

export { ProcessExitError } from './process.js';
