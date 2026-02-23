import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';

function createContext(
  vfs: VFS,
  args: string[],
  cwd = '/',
): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
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

describe('basename', () => {
  it('strips directory from path', async () => {
    const vfs = new VFS();
    const { default: basename } = await import('../../src/commands/fs/basename.js');
    const ctx = createContext(vfs, ['/home/user/file.txt']);
    const code = await basename(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('file.txt\n');
  });

  it('strips suffix when provided', async () => {
    const vfs = new VFS();
    const { default: basename } = await import('../../src/commands/fs/basename.js');
    const ctx = createContext(vfs, ['/home/user/file.txt', '.txt']);
    const code = await basename(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('file\n');
  });

  it('handles bare filename', async () => {
    const vfs = new VFS();
    const { default: basename } = await import('../../src/commands/fs/basename.js');
    const ctx = createContext(vfs, ['hello']);
    const code = await basename(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello\n');
  });

  it('errors with no args', async () => {
    const vfs = new VFS();
    const { default: basename } = await import('../../src/commands/fs/basename.js');
    const ctx = createContext(vfs, []);
    const code = await basename(ctx);
    expect(code).toBe(1);
  });
});

describe('dirname', () => {
  it('extracts directory from path', async () => {
    const vfs = new VFS();
    const { default: dirname } = await import('../../src/commands/fs/dirname.js');
    const ctx = createContext(vfs, ['/home/user/file.txt']);
    const code = await dirname(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/home/user\n');
  });

  it('handles root path', async () => {
    const vfs = new VFS();
    const { default: dirname } = await import('../../src/commands/fs/dirname.js');
    const ctx = createContext(vfs, ['/file.txt']);
    const code = await dirname(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/\n');
  });

  it('handles multiple arguments', async () => {
    const vfs = new VFS();
    const { default: dirname } = await import('../../src/commands/fs/dirname.js');
    const ctx = createContext(vfs, ['/a/b', '/c/d']);
    const code = await dirname(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/a\n/c\n');
  });

  it('errors with no args', async () => {
    const vfs = new VFS();
    const { default: dirname } = await import('../../src/commands/fs/dirname.js');
    const ctx = createContext(vfs, []);
    const code = await dirname(ctx);
    expect(code).toBe(1);
  });
});

describe('rmdir', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/test');
    vfs.mkdir('/test/empty');
    vfs.mkdir('/test/notempty');
    vfs.writeFile('/test/notempty/file.txt', 'content');
  });

  it('removes an empty directory', async () => {
    const { default: rmdir } = await import('../../src/commands/fs/rmdir.js');
    const ctx = createContext(vfs, ['/test/empty']);
    const code = await rmdir(ctx);
    expect(code).toBe(0);
    expect(() => vfs.stat('/test/empty')).toThrow();
  });

  it('errors on non-empty directory', async () => {
    const { default: rmdir } = await import('../../src/commands/fs/rmdir.js');
    const ctx = createContext(vfs, ['/test/notempty']);
    const code = await rmdir(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('not empty');
  });

  it('removes parents with -p', async () => {
    vfs.mkdir('/a/b/c', { recursive: true });
    const { default: rmdir } = await import('../../src/commands/fs/rmdir.js');
    const ctx = createContext(vfs, ['-p', '/a/b/c']);
    const code = await rmdir(ctx);
    expect(code).toBe(0);
    expect(() => vfs.stat('/a/b/c')).toThrow();
    expect(() => vfs.stat('/a/b')).toThrow();
    expect(() => vfs.stat('/a')).toThrow();
  });

  it('errors with no args', async () => {
    const { default: rmdir } = await import('../../src/commands/fs/rmdir.js');
    const ctx = createContext(vfs, []);
    const code = await rmdir(ctx);
    expect(code).toBe(1);
  });
});

describe('realpath', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user', { recursive: true });
    vfs.writeFile('/home/user/test.txt', 'hello');
  });

  it('resolves relative path', async () => {
    const { default: realpath } = await import('../../src/commands/fs/realpath.js');
    const ctx = createContext(vfs, ['test.txt'], '/home/user');
    const code = await realpath(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/home/user/test.txt\n');
  });

  it('resolves absolute path', async () => {
    const { default: realpath } = await import('../../src/commands/fs/realpath.js');
    const ctx = createContext(vfs, ['/home/user/test.txt']);
    const code = await realpath(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/home/user/test.txt\n');
  });

  it('errors on non-existent file', async () => {
    const { default: realpath } = await import('../../src/commands/fs/realpath.js');
    const ctx = createContext(vfs, ['/nonexistent']);
    const code = await realpath(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('realpath');
  });

  it('resolves dot path', async () => {
    const { default: realpath } = await import('../../src/commands/fs/realpath.js');
    const ctx = createContext(vfs, ['.'], '/home/user');
    const code = await realpath(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('/home/user\n');
  });
});

describe('mktemp', () => {
  it('creates a temp file', async () => {
    const vfs = new VFS();
    vfs.mkdir('/tmp');
    const { default: mktemp } = await import('../../src/commands/fs/mktemp.js');
    const ctx = createContext(vfs, []);
    const code = await mktemp(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toMatch(/^\/tmp\/tmp\..+$/);
    // File should exist
    const path = ctx.stdout.text.trim();
    expect(() => vfs.stat(path)).not.toThrow();
  });

  it('creates a temp directory with -d', async () => {
    const vfs = new VFS();
    vfs.mkdir('/tmp');
    const { default: mktemp } = await import('../../src/commands/fs/mktemp.js');
    const ctx = createContext(vfs, ['-d']);
    const code = await mktemp(ctx);
    expect(code).toBe(0);
    const path = ctx.stdout.text.trim();
    const st = vfs.stat(path);
    expect(st.type).toBe('directory');
  });

  it('uses custom template', async () => {
    const vfs = new VFS();
    vfs.mkdir('/tmp');
    const { default: mktemp } = await import('../../src/commands/fs/mktemp.js');
    const ctx = createContext(vfs, ['myfile.XXXX']);
    const code = await mktemp(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toMatch(/^\/tmp\/myfile\..{4}$/);
  });

  it('uses custom directory with -p', async () => {
    const vfs = new VFS();
    vfs.mkdir('/var/tmp', { recursive: true });
    const { default: mktemp } = await import('../../src/commands/fs/mktemp.js');
    const ctx = createContext(vfs, ['-p', '/var/tmp']);
    const code = await mktemp(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toMatch(/^\/var\/tmp\//);
  });
});

describe('chown', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.writeFile('/test.txt', 'hello');
  });

  it('succeeds on existing file (no-op)', async () => {
    const { default: chown } = await import('../../src/commands/fs/chown.js');
    const ctx = createContext(vfs, ['user:user', '/test.txt']);
    const code = await chown(ctx);
    expect(code).toBe(0);
  });

  it('errors on non-existent file', async () => {
    const { default: chown } = await import('../../src/commands/fs/chown.js');
    const ctx = createContext(vfs, ['user', '/nonexistent']);
    const code = await chown(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('chown');
  });

  it('errors with too few args', async () => {
    const { default: chown } = await import('../../src/commands/fs/chown.js');
    const ctx = createContext(vfs, ['user']);
    const code = await chown(ctx);
    expect(code).toBe(1);
  });
});
