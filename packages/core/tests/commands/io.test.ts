import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream, CommandInputStream } from '../../src/commands/types.js';

function createContext(
  vfs: VFS,
  args: string[],
  cwd = '/',
  stdin?: string,
): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  const stdinStream: CommandInputStream | undefined = stdin !== undefined
    ? { read: async () => null, readAll: async () => stdin }
    : undefined;
  return {
    args,
    env: { HOME: '/home/user', USER: 'user' },
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
    stdin: stdinStream,
  };
}

describe('tee', () => {
  it('writes to stdout and file', async () => {
    const vfs = new VFS();
    const { default: tee } = await import('../../src/commands/io/tee.js');
    const ctx = createContext(vfs, ['/out.txt'], '/', 'hello\n');
    const code = await tee(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello\n');
    expect(vfs.readFileString('/out.txt')).toBe('hello\n');
  });

  it('appends with -a', async () => {
    const vfs = new VFS();
    vfs.writeFile('/out.txt', 'existing\n');
    const { default: tee } = await import('../../src/commands/io/tee.js');
    const ctx = createContext(vfs, ['-a', '/out.txt'], '/', 'new\n');
    const code = await tee(ctx);
    expect(code).toBe(0);
    expect(vfs.readFileString('/out.txt')).toBe('existing\nnew\n');
  });
});

describe('printf', () => {
  it('formats string with %s', async () => {
    const vfs = new VFS();
    const { default: printf } = await import('../../src/commands/io/printf.js');
    const ctx = createContext(vfs, ['hello %s', 'world']);
    const code = await printf(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello world');
  });

  it('formats number with %d', async () => {
    const vfs = new VFS();
    const { default: printf } = await import('../../src/commands/io/printf.js');
    const ctx = createContext(vfs, ['count: %d', '42']);
    const code = await printf(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('count: 42');
  });

  it('handles escape sequences', async () => {
    const vfs = new VFS();
    const { default: printf } = await import('../../src/commands/io/printf.js');
    const ctx = createContext(vfs, ['a\\nb']);
    const code = await printf(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('a\nb');
  });

  it('does not add trailing newline', async () => {
    const vfs = new VFS();
    const { default: printf } = await import('../../src/commands/io/printf.js');
    const ctx = createContext(vfs, ['hello']);
    const code = await printf(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('hello');
  });
});

describe('yes', () => {
  it('outputs default string until aborted', async () => {
    const vfs = new VFS();
    const { default: yes } = await import('../../src/commands/io/yes.js');
    const controller = new AbortController();
    const stdout = { text: '', write(t: string) { this.text += t; } };
    const stderr = { text: '', write(t: string) { this.text += t; } };
    let lineCount = 0;

    const ctx: CommandContext & { stdout: typeof stdout; stderr: typeof stderr } = {
      args: [],
      env: { HOME: '/home/user', USER: 'user' },
      cwd: '/',
      vfs,
      stdout: {
        text: '',
        write(t: string) {
          this.text += t;
          lineCount++;
          if (lineCount >= 5) controller.abort();
        },
      },
      stderr,
      signal: controller.signal,
    };

    await yes(ctx);
    expect(ctx.stdout.text).toContain('y\n');
  });

  it('outputs custom string', async () => {
    const vfs = new VFS();
    const { default: yes } = await import('../../src/commands/io/yes.js');
    const controller = new AbortController();
    const stderr = { text: '', write(t: string) { this.text += t; } };
    let lineCount = 0;

    const ctx = {
      args: ['hello'],
      env: { HOME: '/home/user', USER: 'user' },
      cwd: '/',
      vfs,
      stdout: {
        text: '',
        write(t: string) {
          this.text += t;
          lineCount++;
          if (lineCount >= 3) controller.abort();
        },
      },
      stderr,
      signal: controller.signal,
    };

    await yes(ctx as unknown as CommandContext);
    expect(ctx.stdout.text).toContain('hello\n');
  });
});

describe('xargs', () => {
  it('passes stdin args to command', async () => {
    const vfs = new VFS();
    const { default: xargs } = await import('../../src/commands/io/xargs.js');
    const ctx = createContext(vfs, ['echo'], '/', 'a b c\n');
    const code = await xargs(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('echo a b c\n');
  });

  it('batches with -n', async () => {
    const vfs = new VFS();
    const { default: xargs } = await import('../../src/commands/io/xargs.js');
    const ctx = createContext(vfs, ['-n', '2', 'echo'], '/', 'a b c d\n');
    const code = await xargs(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toBe('echo a b\necho c d\n');
  });
});
