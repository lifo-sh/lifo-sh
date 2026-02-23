import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';

function createContext(vfs: VFS, args: string[], cwd = '/'): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env: { HOME: '/home/user', USER: 'user' },
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
  };
}

describe('tar', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/tmp');
    vfs.mkdir('/test');
    vfs.writeFile('/test/a.txt', 'hello');
    vfs.writeFile('/test/b.txt', 'world');
  });

  it('creates and extracts a tar archive', async () => {
    const { default: tar } = await import('../../src/commands/archive/tar.js');

    // Create
    const ctx1 = createContext(vfs, ['-cf', '/tmp/archive.tar', '/test/a.txt', '/test/b.txt']);
    expect(await tar(ctx1)).toBe(0);
    expect(vfs.exists('/tmp/archive.tar')).toBe(true);

    // Extract
    vfs.mkdir('/tmp/extract');
    const ctx2 = createContext(vfs, ['-xf', '/tmp/archive.tar', '-C', '/tmp/extract']);
    expect(await tar(ctx2)).toBe(0);
    expect(vfs.readFileString('/tmp/extract/a.txt')).toBe('hello');
    expect(vfs.readFileString('/tmp/extract/b.txt')).toBe('world');
  });

  it('lists tar contents', async () => {
    const { default: tar } = await import('../../src/commands/archive/tar.js');

    const ctx1 = createContext(vfs, ['-cf', '/tmp/archive.tar', '/test/a.txt']);
    await tar(ctx1);

    const ctx2 = createContext(vfs, ['-tf', '/tmp/archive.tar']);
    expect(await tar(ctx2)).toBe(0);
    expect(ctx2.stdout.text).toContain('a.txt');
  });

  it('errors without -c, -x, or -t', async () => {
    const { default: tar } = await import('../../src/commands/archive/tar.js');
    const ctx = createContext(vfs, ['-f', '/tmp/test.tar']);
    expect(await tar(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('must specify');
  });

  it('errors without -f', async () => {
    const { default: tar } = await import('../../src/commands/archive/tar.js');
    const ctx = createContext(vfs, ['-c']);
    expect(await tar(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('-f is required');
  });
});

describe('gzip / gunzip', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.writeFile('/test.txt', 'hello compression');
  });

  it('gzip creates .gz and removes original', async () => {
    const { default: gzip } = await import('../../src/commands/archive/gzip.js');
    const ctx = createContext(vfs, ['/test.txt']);
    expect(await gzip(ctx)).toBe(0);
    expect(vfs.exists('/test.txt.gz')).toBe(true);
    expect(vfs.exists('/test.txt')).toBe(false);
  });

  it('gzip -k keeps original', async () => {
    const { default: gzip } = await import('../../src/commands/archive/gzip.js');
    const ctx = createContext(vfs, ['-k', '/test.txt']);
    expect(await gzip(ctx)).toBe(0);
    expect(vfs.exists('/test.txt.gz')).toBe(true);
    expect(vfs.exists('/test.txt')).toBe(true);
  });

  it('gunzip restores original', async () => {
    const { default: gzip } = await import('../../src/commands/archive/gzip.js');
    const { default: gunzip } = await import('../../src/commands/archive/gunzip.js');

    // Compress
    await gzip(createContext(vfs, ['/test.txt']));
    expect(vfs.exists('/test.txt')).toBe(false);

    // Decompress
    const ctx = createContext(vfs, ['/test.txt.gz']);
    expect(await gunzip(ctx)).toBe(0);
    expect(vfs.exists('/test.txt')).toBe(true);
    expect(vfs.readFileString('/test.txt')).toBe('hello compression');
    expect(vfs.exists('/test.txt.gz')).toBe(false);
  });

  it('gunzip errors on non-.gz file', async () => {
    const { default: gunzip } = await import('../../src/commands/archive/gunzip.js');
    const ctx = createContext(vfs, ['/test.txt']);
    expect(await gunzip(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('unknown suffix');
  });

  it('gzip errors on missing file', async () => {
    const { default: gzip } = await import('../../src/commands/archive/gzip.js');
    const ctx = createContext(vfs, ['/nonexistent.txt']);
    expect(await gzip(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('ENOENT');
  });
});

describe('zip / unzip', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/tmp');
    vfs.mkdir('/data');
    vfs.writeFile('/data/a.txt', 'alpha');
    vfs.writeFile('/data/b.txt', 'beta');
  });

  it('zip creates archive and unzip extracts', async () => {
    const { default: zip } = await import('../../src/commands/archive/zip.js');
    const { default: unzip } = await import('../../src/commands/archive/unzip.js');

    const ctx1 = createContext(vfs, ['/tmp/out.zip', '/data/a.txt', '/data/b.txt']);
    expect(await zip(ctx1)).toBe(0);
    expect(vfs.exists('/tmp/out.zip')).toBe(true);

    vfs.mkdir('/tmp/extract');
    const ctx2 = createContext(vfs, ['-d', '/tmp/extract', '/tmp/out.zip']);
    expect(await unzip(ctx2)).toBe(0);
    expect(vfs.readFileString('/tmp/extract/a.txt')).toBe('alpha');
    expect(vfs.readFileString('/tmp/extract/b.txt')).toBe('beta');
  });

  it('unzip -l lists contents', async () => {
    const { default: zip } = await import('../../src/commands/archive/zip.js');
    const { default: unzip } = await import('../../src/commands/archive/unzip.js');

    await zip(createContext(vfs, ['/tmp/out.zip', '/data/a.txt']));

    const ctx = createContext(vfs, ['-l', '/tmp/out.zip']);
    expect(await unzip(ctx)).toBe(0);
    expect(ctx.stdout.text).toContain('a.txt');
    expect(ctx.stdout.text).toContain('Length');
  });

  it('zip errors without files', async () => {
    const { default: zip } = await import('../../src/commands/archive/zip.js');
    const ctx = createContext(vfs, ['/tmp/out.zip']);
    expect(await zip(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('no files');
  });

  it('unzip errors on missing archive', async () => {
    const { default: unzip } = await import('../../src/commands/archive/unzip.js');
    const ctx = createContext(vfs, ['/nonexistent.zip']);
    expect(await unzip(ctx)).toBe(1);
    expect(ctx.stderr.text).toContain('ENOENT');
  });
});
