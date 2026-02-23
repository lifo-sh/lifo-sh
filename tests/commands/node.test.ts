import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';

function createContext(vfs: VFS, args: string[], cwd = '/'): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env: { HOME: '/home/user', USER: 'user', HOSTNAME: 'browseros' },
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
    expect(ctx.stdout.text).toBe('browseros\n');
  });
});
