import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream, CommandInputStream } from '../../src/commands/types.js';

function createContext(
  vfs: VFS,
  args: string[],
  cwd = '/',
  stdin?: CommandInputStream,
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
    stdin,
  };
}

function createStdin(content: string): CommandInputStream {
  let read = false;
  return {
    async read() { if (read) return null; read = true; return content; },
    async readAll() { return content; },
  };
}

describe('diff', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
  });

  it('returns 0 for identical files', async () => {
    vfs.writeFile('/a.txt', 'hello\nworld\n');
    vfs.writeFile('/b.txt', 'hello\nworld\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt', '/b.txt']);
    const code = await diff(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('');
  });

  it('returns 1 for different files (normal format)', async () => {
    vfs.writeFile('/a.txt', 'hello\nworld\n');
    vfs.writeFile('/b.txt', 'hello\nearth\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt', '/b.txt']);
    const code = await diff(ctx);
    expect(code).toBe(1);
    expect(ctx.stdout.text).toContain('< world');
    expect(ctx.stdout.text).toContain('> earth');
  });

  it('supports unified format with -u', async () => {
    vfs.writeFile('/a.txt', 'hello\nworld\n');
    vfs.writeFile('/b.txt', 'hello\nearth\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['-u', '/a.txt', '/b.txt']);
    const code = await diff(ctx);
    expect(code).toBe(1);
    expect(ctx.stdout.text).toContain('--- /a.txt');
    expect(ctx.stdout.text).toContain('+++ /b.txt');
    expect(ctx.stdout.text).toContain('@@');
  });

  it('handles additions', async () => {
    vfs.writeFile('/a.txt', 'line1\n');
    vfs.writeFile('/b.txt', 'line1\nline2\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt', '/b.txt']);
    const code = await diff(ctx);
    expect(code).toBe(1);
    expect(ctx.stdout.text).toContain('> line2');
  });

  it('handles deletions', async () => {
    vfs.writeFile('/a.txt', 'line1\nline2\n');
    vfs.writeFile('/b.txt', 'line1\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt', '/b.txt']);
    const code = await diff(ctx);
    expect(code).toBe(1);
    expect(ctx.stdout.text).toContain('< line2');
  });

  it('returns 2 for missing file', async () => {
    vfs.writeFile('/a.txt', 'hello\n');
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt', '/nonexistent']);
    const code = await diff(ctx);
    expect(code).toBe(2);
    expect(ctx.stderr.text).toContain('diff');
  });

  it('errors with too few args', async () => {
    const { default: diff } = await import('../../src/commands/text/diff.js');
    const ctx = createContext(vfs, ['/a.txt']);
    const code = await diff(ctx);
    expect(code).toBe(2);
  });
});

describe('nl', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
  });

  it('numbers non-empty lines by default', async () => {
    vfs.writeFile('/test.txt', 'hello\n\nworld\n');
    const { default: nl } = await import('../../src/commands/text/nl.js');
    const ctx = createContext(vfs, ['/test.txt']);
    const code = await nl(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('1');
    expect(ctx.stdout.text).toContain('hello');
    expect(ctx.stdout.text).toContain('2');
    expect(ctx.stdout.text).toContain('world');
  });

  it('numbers all lines with -b a', async () => {
    vfs.writeFile('/test.txt', 'hello\n\nworld\n');
    const { default: nl } = await import('../../src/commands/text/nl.js');
    const ctx = createContext(vfs, ['-b', 'a', '/test.txt']);
    const code = await nl(ctx);
    expect(code).toBe(0);
    // Empty line should have number 2
    const lines = ctx.stdout.text.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(3);
    expect(lines[1]).toContain('2');
  });

  it('respects -w width', async () => {
    vfs.writeFile('/test.txt', 'hello\n');
    const { default: nl } = await import('../../src/commands/text/nl.js');
    const ctx = createContext(vfs, ['-w', '3', '/test.txt']);
    const code = await nl(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toMatch(/^\s+1\t/);
  });

  it('reads from stdin', async () => {
    const { default: nl } = await import('../../src/commands/text/nl.js');
    const ctx = createContext(vfs, [], '/', createStdin('line1\nline2\n'));
    const code = await nl(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('line1');
    expect(ctx.stdout.text).toContain('line2');
  });
});

describe('rev', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
  });

  it('reverses characters in each line', async () => {
    vfs.writeFile('/test.txt', 'hello\nworld\n');
    const { default: rev } = await import('../../src/commands/text/rev.js');
    const ctx = createContext(vfs, ['/test.txt']);
    const code = await rev(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('olleh');
    expect(ctx.stdout.text).toContain('dlrow');
  });

  it('reads from stdin', async () => {
    const { default: rev } = await import('../../src/commands/text/rev.js');
    const ctx = createContext(vfs, [], '/', createStdin('abc'));
    const code = await rev(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('cba');
  });

  it('handles multiple files', async () => {
    vfs.writeFile('/a.txt', 'hello\n');
    vfs.writeFile('/b.txt', 'world\n');
    const { default: rev } = await import('../../src/commands/text/rev.js');
    const ctx = createContext(vfs, ['/a.txt', '/b.txt']);
    const code = await rev(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('olleh');
    expect(ctx.stdout.text).toContain('dlrow');
  });

  it('errors on non-existent file', async () => {
    const { default: rev } = await import('../../src/commands/text/rev.js');
    const ctx = createContext(vfs, ['/nonexistent']);
    const code = await rev(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('rev');
  });
});
