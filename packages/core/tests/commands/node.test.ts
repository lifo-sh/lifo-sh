import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';
import type { VirtualRequestHandler } from '../../src/kernel/index.js';
import { createNodeCommand } from '../../src/commands/system/node.js';
import { createCurlCommand } from '../../src/commands/net/curl.js';
import { createNpxCommand } from '../../src/commands/system/npm.js';
import { CommandRegistry } from '../../src/commands/registry.js';

function createContext(vfs: VFS, args: string[], cwd = '/'): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env: { HOME: '/home/user', USER: 'user', HOSTNAME: 'lifo' },
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
  };
}

describe('node command', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home');
    vfs.mkdir('/home/user');
    vfs.mkdir('/tmp');
    vfs.mkdir('/usr', { recursive: true });
    vfs.mkdir('/usr/share/pkg/node_modules', { recursive: true });
  });

  it('runs console.log script', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', 'console.log("hello")');
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello\n');
  });

  it('-e evaluates inline code', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    const ctx = createContext(vfs, ['-e', 'console.log(1+2)']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('3\n');
  });

  it('-v prints version', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    const ctx = createContext(vfs, ['-v']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toMatch(/^v\d+/);
  });

  it('require("fs").readFileSync works', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/data.txt', 'file content');
    vfs.writeFile('/tmp/test.js', `
      const fs = require('fs');
      const content = fs.readFileSync('/tmp/data.txt', 'utf-8');
      console.log(content);
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('file content\n');
  });

  it('require("path").join works', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', `
      const path = require('path');
      console.log(path.join('/foo', 'bar', 'baz'));
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/foo/bar/baz\n');
  });

  it('process.argv includes script args', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', 'console.log(process.argv.join(","))');
    const ctx = createContext(vfs, ['/tmp/test.js', 'arg1', 'arg2']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('arg1');
    expect(ctx.stdout.text).toContain('arg2');
  });

  it('process.exit(42) returns exit code 42', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', 'process.exit(42)');
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(42);
  });

  it('__filename and __dirname are correct', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', 'console.log(__filename + ":" + __dirname)');
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/tmp/test.js:/tmp\n');
  });

  it('relative require works', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/lib.js', 'module.exports = { greet: () => "hi" };');
    vfs.writeFile('/tmp/main.js', `
      const lib = require('./lib');
      console.log(lib.greet());
    `);
    const ctx = createContext(vfs, ['/tmp/main.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hi\n');
  });

  it('JSON require works', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/config.json', '{"key": "value"}');
    vfs.writeFile('/tmp/main.js', `
      const config = require('./config.json');
      console.log(config.key);
    `);
    const ctx = createContext(vfs, ['/tmp/main.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('value\n');
  });

  it('error in script shows message on stderr', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', 'throw new Error("boom")');
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('boom');
  });

  it('missing file returns exit code 1', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    const ctx = createContext(vfs, ['/tmp/nonexistent.js']);
    const code = await node(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('ENOENT');
  });

  it('require("os").hostname() returns hostname', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    const ctx = createContext(vfs, ['-e', 'console.log(require("os").hostname())']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('lifo\n');
  });
});

describe('node command ESM support', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home');
    vfs.mkdir('/home/user');
    vfs.mkdir('/tmp');
    vfs.mkdir('/usr', { recursive: true });
    vfs.mkdir('/usr/share/pkg/node_modules', { recursive: true });
  });

  it('import default from builtin', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
import path from 'path';
console.log(path.join('/a', 'b'));
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/a/b\n');
  });

  it('import { named } from builtin', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
import { join, resolve } from 'path';
console.log(join('/x', 'y'));
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/x/y\n');
  });

  it('import * as namespace from builtin', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
import * as os from 'os';
console.log(os.hostname());
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('lifo\n');
  });

  it('import with alias (as)', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
import { join as pathJoin } from 'path';
console.log(pathJoin('/a', 'b'));
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/a/b\n');
  });

  it('side-effect import', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/setup.js', 'console.log("setup-ran");');
    vfs.writeFile('/tmp/test.mjs', `
import './setup.js';
console.log('done');
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('setup-ran\ndone\n');
  });

  it('import default from relative file', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/lib.mjs', `
export default function greet() { return 'hello'; }
    `);
    vfs.writeFile('/tmp/test.mjs', `
import greet from './lib.mjs';
console.log(greet());
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello\n');
  });

  it('export const and import named', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/math.mjs', `
export const PI = 3.14;
export const add = (a, b) => a + b;
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { PI, add } from './math.mjs';
console.log(PI + ' ' + add(1, 2));
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('3.14 3\n');
  });

  it('export function', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/utils.mjs', `
export function double(n) { return n * 2; }
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { double } from './utils.mjs';
console.log(double(5));
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('10\n');
  });

  it('export class', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/animal.mjs', `
export class Animal {
  constructor(name) { this.name = name; }
  speak() { return this.name + ' speaks'; }
}
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { Animal } from './animal.mjs';
const a = new Animal('Dog');
console.log(a.speak());
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('Dog speaks\n');
  });

  it('export { a, b as c }', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/stuff.mjs', `
const x = 10;
const y = 20;
export { x, y as z };
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { x, z } from './stuff.mjs';
console.log(x + z);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('30\n');
  });

  it('export * from (re-export all)', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/base.mjs', `
export const a = 1;
export const b = 2;
    `);
    vfs.writeFile('/tmp/reexport.mjs', `
export * from './base.mjs';
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { a, b } from './reexport.mjs';
console.log(a + b);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('3\n');
  });

  it('export { x } from (re-export named)', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/base.mjs', `
export const foo = 'bar';
export const baz = 'qux';
    `);
    vfs.writeFile('/tmp/reexport.mjs', `
export { foo } from './base.mjs';
    `);
    vfs.writeFile('/tmp/test.mjs', `
import { foo } from './reexport.mjs';
console.log(foo);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('bar\n');
  });

  it('node: prefix works (import fs from "node:fs")', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/data.txt', 'node-prefix');
    vfs.writeFile('/tmp/test.mjs', `
import fs from 'node:fs';
const content = fs.readFileSync('/tmp/data.txt', 'utf-8');
console.log(content);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('node-prefix\n');
  });

  it('.mjs extension forces ESM mode', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
import path from 'path';
console.log(typeof path.join);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('function\n');
  });

  it('-e with ESM syntax', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    const ctx = createContext(vfs, ['-e', 'import path from "path"; console.log(path.join("/a", "b"))']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/a/b\n');
  });

  it('CJS requiring ESM child module', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/esm-child.mjs', `
export const val = 42;
    `);
    vfs.writeFile('/tmp/main.js', `
const child = require('./esm-child.mjs');
console.log(child.val);
    `);
    const ctx = createContext(vfs, ['/tmp/main.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('42\n');
  });

  it('ESM importing CJS child module', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/cjs-child.js', `
module.exports = { value: 'from-cjs' };
    `);
    vfs.writeFile('/tmp/test.mjs', `
import child from './cjs-child.js';
console.log(child.value);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('from-cjs\n');
  });

  it('mixed default + named exports', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/mixed.mjs', `
export default 'main';
export const extra = 'bonus';
    `);
    vfs.writeFile('/tmp/test.mjs', `
import mixed from './mixed.mjs';
import { extra } from './mixed.mjs';
console.log(mixed.default + ' ' + mixed.extra);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('main bonus\n');
  });

  it('top-level await in main script', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
const result = await Promise.resolve(42);
console.log(result);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('42\n');
  });

  it('import.meta.url returns file:// URL', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.mjs', `
console.log(import.meta.url);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('file:///tmp/test.mjs\n');
  });

  it('dynamic import()', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/dyn.mjs', `
export const val = 99;
    `);
    vfs.writeFile('/tmp/test.mjs', `
const mod = await import('./dyn.mjs');
console.log(mod.val);
    `);
    const ctx = createContext(vfs, ['/tmp/test.mjs']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('99\n');
  });

  it('CJS still works (regression)', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', `
const path = require('path');
console.log(path.join('/a', 'b'));
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/a/b\n');
  });

  it('.mjs resolved without extension in require', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/mymod.mjs', `
export const greeting = 'hi';
    `);
    vfs.writeFile('/tmp/test.js', `
const m = require('./mymod');
console.log(m.greeting);
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hi\n');
  });
});

describe('http.createServer via node command', () => {
  let vfs: VFS;
  let portRegistry: Map<number, VirtualRequestHandler>;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home');
    vfs.mkdir('/home/user');
    vfs.mkdir('/tmp');
    vfs.mkdir('/usr', { recursive: true });
    vfs.mkdir('/usr/share/pkg/node_modules', { recursive: true });
    portRegistry = new Map();
  });

  it('http.createServer throws without portRegistry', async () => {
    const { default: node } = await import('../../src/commands/system/node.js');
    vfs.writeFile('/tmp/test.js', `
      const http = require('http');
      http.createServer();
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('not supported');
  });

  it('createServer + listen registers handler in portRegistry', async () => {
    const node = createNodeCommand(portRegistry);
    vfs.writeFile('/tmp/test.js', `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('hello');
      });
      server.listen(4000, () => {
        console.log('listening');
        server.close();
      });
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('listening');
  });

  it('virtual http.get connects to virtual server', async () => {
    const node = createNodeCommand(portRegistry);
    vfs.writeFile('/tmp/test.js', `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from virtual server');
      });
      server.listen(5000, () => {
        http.get('http://localhost:5000/', (res) => {
          res.on('data', (data) => {
            console.log(data);
            server.close();
          });
        });
      });
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Hello from virtual server');
  });

  it('curl connects to virtual server via portRegistry', async () => {
    // First, manually register a handler in portRegistry
    portRegistry.set(6000, (req, res) => {
      res.statusCode = 200;
      res.headers['content-type'] = 'text/plain';
      res.body = 'curl response\n';
    });

    const curl = createCurlCommand(portRegistry);
    const ctx = createContext(vfs, ['http://localhost:6000/']);
    const code = await curl(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('curl response');
  });

  it('server.close removes handler from portRegistry', async () => {
    const node = createNodeCommand(portRegistry);
    vfs.writeFile('/tmp/test.js', `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.end('ok');
      });
      server.listen(7000, () => {
        server.close(() => {
          console.log('closed');
        });
      });
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    const code = await node(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('closed');
    expect(portRegistry.has(7000)).toBe(false);
  });

  it('abort signal closes active servers', async () => {
    const node = createNodeCommand(portRegistry);
    const ac = new AbortController();
    vfs.writeFile('/tmp/test.js', `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.end('ok');
      });
      server.listen(8000, () => {
        console.log('started');
      });
    `);
    const ctx = createContext(vfs, ['/tmp/test.js']);
    ctx.signal = ac.signal;

    // Start the server and abort after a tick
    const promise = node(ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(portRegistry.has(8000)).toBe(true);
    ac.abort();

    const code = await promise;
    expect(code).toBe(0);
    expect(portRegistry.has(8000)).toBe(false);
  });
});

describe('npx command', () => {
  let vfs: VFS;
  let registry: CommandRegistry;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user', { recursive: true });
    vfs.mkdir('/tmp');
    vfs.mkdir('/usr/lib/node_modules', { recursive: true });
    vfs.mkdir('/usr/bin', { recursive: true });
    vfs.mkdir('/usr/share/pkg/node_modules', { recursive: true });

    registry = new CommandRegistry();
    // Register the node command so npx fallback works
    registry.register('node', createNodeCommand());
  });

  it('--version prints version', async () => {
    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['--version']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('--help shows usage', async () => {
    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['--help']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Usage: npx');
    expect(ctx.stdout.text).toContain('--package');
  });

  it('no args prints error', async () => {
    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, []);
    const code = await npx(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('missing package');
  });

  it('finds and runs a locally installed bin', async () => {
    // Set up a fake local package with a bin entry
    const pkgDir = '/projects/myapp/node_modules/hello-cli';
    vfs.mkdir(pkgDir, { recursive: true });
    vfs.writeFile(
      pkgDir + '/package.json',
      JSON.stringify({ name: 'hello-cli', version: '1.0.0', bin: { 'hello-cli': './bin/hello.js' } }),
    );
    vfs.mkdir(pkgDir + '/bin', { recursive: true });
    vfs.writeFile(pkgDir + '/bin/hello.js', 'console.log("hello from local");');

    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['hello-cli'], '/projects/myapp');
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello from local\n');
  });

  it('finds and runs a globally installed bin', async () => {
    const pkgDir = '/usr/lib/node_modules/greet-cli';
    vfs.mkdir(pkgDir, { recursive: true });
    vfs.writeFile(
      pkgDir + '/package.json',
      JSON.stringify({ name: 'greet-cli', version: '2.0.0', bin: { 'greet-cli': './index.js' } }),
    );
    vfs.writeFile(pkgDir + '/index.js', 'console.log("hello from global");');

    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['greet-cli']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello from global\n');
  });

  it('errors on missing package (no registry)', async () => {
    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['nonexistent-pkg-12345']);
    const code = await npx(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('nonexistent-pkg-12345');
  });

  it('passes args through to the script', async () => {
    const pkgDir = '/usr/lib/node_modules/echo-args';
    vfs.mkdir(pkgDir, { recursive: true });
    vfs.writeFile(
      pkgDir + '/package.json',
      JSON.stringify({ name: 'echo-args', version: '1.0.0', bin: { 'echo-args': './run.js' } }),
    );
    vfs.writeFile(pkgDir + '/run.js', 'console.log(process.argv.slice(2).join(" "));');

    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['echo-args', 'foo', 'bar']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('foo bar\n');
  });

  it('npx cache layout allows dependency resolution', async () => {
    // Simulate npx flat install: both main pkg and dep under /tmp/.npx-cache/node_modules/
    const cacheBase = '/tmp/.npx-cache/node_modules';
    const pkgDir = cacheBase + '/my-cli';
    const depDir = cacheBase + '/my-dep';

    vfs.mkdir(pkgDir, { recursive: true });
    vfs.writeFile(
      pkgDir + '/package.json',
      JSON.stringify({ name: 'my-cli', version: '1.0.0', bin: { 'my-cli': './cli.js' }, main: './cli.js' }),
    );
    vfs.writeFile(pkgDir + '/cli.js', `
      const dep = require('my-dep');
      console.log(dep.hello());
    `);

    vfs.mkdir(depDir, { recursive: true });
    vfs.writeFile(
      depDir + '/package.json',
      JSON.stringify({ name: 'my-dep', version: '1.0.0', main: './index.js' }),
    );
    vfs.writeFile(depDir + '/index.js', `
      module.exports = { hello: () => 'from-dep' };
    `);

    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['my-cli']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('from-dep\n');
  });

  it('--package flag uses explicit package with different bin name', async () => {
    const pkgDir = '/usr/lib/node_modules/my-tools';
    vfs.mkdir(pkgDir, { recursive: true });
    vfs.writeFile(
      pkgDir + '/package.json',
      JSON.stringify({ name: 'my-tools', version: '1.0.0', bin: { mytool: './cli.js' } }),
    );
    vfs.writeFile(pkgDir + '/cli.js', 'console.log("tool ran");');

    const npx = createNpxCommand(registry);
    const ctx = createContext(vfs, ['--package=my-tools', 'mytool']);
    const code = await npx(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('tool ran\n');
  });
});
