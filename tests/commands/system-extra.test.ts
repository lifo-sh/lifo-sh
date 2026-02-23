import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { JobTable } from '../../src/shell/jobs.js';
import { CommandRegistry } from '../../src/commands/registry.js';
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
    env: { HOME: '/home/user', USER: 'user', HOSTNAME: 'browseros' },
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

describe('ps', () => {
  it('shows shell and ps itself with no jobs', async () => {
    const jobTable = new JobTable();
    const { createPsCommand } = await import('../../src/commands/system/ps.js');
    const ps = createPsCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await ps(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('PID');
    expect(ctx.stdout.text).toContain('sh');
    expect(ctx.stdout.text).toContain('ps');
  });

  it('shows background jobs', async () => {
    const jobTable = new JobTable();
    const ac = new AbortController();
    jobTable.add('sleep 100', new Promise(() => {}), ac);
    const { createPsCommand } = await import('../../src/commands/system/ps.js');
    const ps = createPsCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await ps(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('sleep');
  });
});

describe('top', () => {
  it('shows system snapshot', async () => {
    const jobTable = new JobTable();
    const { createTopCommand } = await import('../../src/commands/system/top.js');
    const top = createTopCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await top(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('top');
    expect(ctx.stdout.text).toContain('Tasks');
    expect(ctx.stdout.text).toContain('sh');
    expect(ctx.stdout.text).toContain('PID');
  });
});

describe('kill', () => {
  it('kills a job by %N', async () => {
    const jobTable = new JobTable();
    const ac = new AbortController();
    jobTable.add('sleep 100', new Promise(() => {}), ac);
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['%1']);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ac.signal.aborted).toBe(true);
  });

  it('kills a job by PID', async () => {
    const jobTable = new JobTable();
    const ac = new AbortController();
    jobTable.add('sleep 100', new Promise(() => {}), ac);
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(jobTable);
    const vfs = new VFS();
    // PID = jobId + 1 = 2
    const ctx = createContext(vfs, ['2']);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ac.signal.aborted).toBe(true);
  });

  it('refuses to kill PID 1 (shell)', async () => {
    const jobTable = new JobTable();
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['1']);
    const code = await kill(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('not permitted');
  });

  it('lists signals with -l', async () => {
    const jobTable = new JobTable();
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['-l']);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('TERM');
    expect(ctx.stdout.text).toContain('KILL');
  });

  it('errors on non-existent job', async () => {
    const jobTable = new JobTable();
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(jobTable);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['%99']);
    const code = await kill(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('no such process');
  });
});

describe('cal', () => {
  it('outputs current month calendar', async () => {
    const vfs = new VFS();
    const { default: cal } = await import('../../src/commands/system/cal.js');
    const ctx = createContext(vfs, []);
    const code = await cal(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Su Mo Tu We Th Fr Sa');
    // Should contain a month name
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const hasMonth = months.some(m => ctx.stdout.text.includes(m));
    expect(hasMonth).toBe(true);
  });

  it('outputs specific month and year', async () => {
    const vfs = new VFS();
    const { default: cal } = await import('../../src/commands/system/cal.js');
    const ctx = createContext(vfs, ['12', '2025']);
    const code = await cal(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('December 2025');
    expect(ctx.stdout.text).toContain('Su Mo Tu We Th Fr Sa');
    // Dec 1, 2025 is a Monday
    expect(ctx.stdout.text).toContain(' 1');
  });

  it('outputs full year', async () => {
    const vfs = new VFS();
    const { default: cal } = await import('../../src/commands/system/cal.js');
    const ctx = createContext(vfs, ['2025']);
    const code = await cal(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('January');
    expect(ctx.stdout.text).toContain('December');
  });
});

describe('bc', () => {
  it('evaluates simple addition', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('2+3'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('5');
  });

  it('evaluates multiplication', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('6*7'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('42');
  });

  it('evaluates power', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('2^10'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('1024');
  });

  it('evaluates sqrt', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('sqrt(144)'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('12');
  });

  it('supports variables', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('a = 5\na * 2'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    const lines = ctx.stdout.text.trim().split('\n');
    expect(lines[lines.length - 1]).toBe('10');
  });

  it('supports scale for decimal precision', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('scale = 2\n10/3'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    const lines = ctx.stdout.text.trim().split('\n');
    expect(lines[lines.length - 1]).toBe('3.33');
  });

  it('supports -e expression', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, ['-e', '2+3']);
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('5');
  });

  it('handles integer division (scale=0)', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('10/3'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('3');
  });

  it('handles parentheses', async () => {
    const vfs = new VFS();
    const { default: bc } = await import('../../src/commands/system/bc.js');
    const ctx = createContext(vfs, [], '/', createStdin('(2+3)*4'));
    const code = await bc(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text.trim()).toBe('20');
  });
});

describe('man', () => {
  it('shows manual page for a command', async () => {
    const vfs = new VFS();
    const { default: man } = await import('../../src/commands/system/man.js');
    const ctx = createContext(vfs, ['ls']);
    const code = await man(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('NAME');
    expect(ctx.stdout.text).toContain('SYNOPSIS');
    expect(ctx.stdout.text).toContain('DESCRIPTION');
    expect(ctx.stdout.text).toContain('ls');
  });

  it('errors on unknown command', async () => {
    const vfs = new VFS();
    const { default: man } = await import('../../src/commands/system/man.js');
    const ctx = createContext(vfs, ['nonexistent']);
    const code = await man(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('no manual entry');
  });

  it('searches with -k', async () => {
    const vfs = new VFS();
    const { default: man } = await import('../../src/commands/system/man.js');
    const ctx = createContext(vfs, ['-k', 'file']);
    const code = await man(ctx);
    expect(code).toBe(0);
    // Should find multiple commands that deal with files
    expect(ctx.stdout.text).toContain('(1)');
  });

  it('errors with no args', async () => {
    const vfs = new VFS();
    const { default: man } = await import('../../src/commands/system/man.js');
    const ctx = createContext(vfs, []);
    const code = await man(ctx);
    expect(code).toBe(1);
  });
});

describe('help', () => {
  it('lists commands grouped by category', async () => {
    const registry = new CommandRegistry();
    registry.register('ls', async () => 0);
    registry.register('cat', async () => 0);
    const { createHelpCommand } = await import('../../src/commands/system/help.js');
    const help = createHelpCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await help(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('BrowserOS Commands');
    expect(ctx.stdout.text).toContain('File system');
    expect(ctx.stdout.text).toContain('Shell builtins');
    expect(ctx.stdout.text).toContain('ls');
  });
});

describe('watch', () => {
  it('errors with no command', async () => {
    const registry = new CommandRegistry();
    const { createWatchCommand } = await import('../../src/commands/system/watch.js');
    const watch = createWatchCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await watch(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('missing command');
  });

  it('errors on unknown command', async () => {
    const registry = new CommandRegistry();
    const { createWatchCommand } = await import('../../src/commands/system/watch.js');
    const watch = createWatchCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['nonexistent']);
    const code = await watch(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('command not found');
  });
});
