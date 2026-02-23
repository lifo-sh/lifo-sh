import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import { Interpreter, type BuiltinFn } from '../../src/shell/interpreter.js';

function createTestShell() {
  const vfs = new VFS();
  const registry = new CommandRegistry();
  const env: Record<string, string> = { HOME: '/home/user', USER: 'user' };
  const aliases = new Map<string, string>();
  let cwd = '/';
  let output = '';
  const builtins = new Map<string, BuiltinFn>();

  // Register echo builtin
  builtins.set('echo', async (args, stdout) => {
    stdout.write(args.join(' ') + '\n');
    return 0;
  });

  // Register export builtin
  builtins.set('export', async (args) => {
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        env[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
      }
    }
    return 0;
  });

  // Register alias builtin
  builtins.set('alias', async (args, stdout) => {
    if (args.length === 0) {
      for (const [name, value] of aliases) {
        stdout.write(`alias ${name}='${value}'\n`);
      }
      return 0;
    }
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        aliases.set(arg.slice(0, eqIdx), arg.slice(eqIdx + 1));
      }
    }
    return 0;
  });

  // Register unalias builtin
  builtins.set('unalias', async (args, _stdout, stderr) => {
    for (const name of args) {
      if (!aliases.delete(name)) {
        stderr.write(`unalias: ${name}: not found\n`);
      }
    }
    return 0;
  });

  const interpreter = new Interpreter({
    env,
    getCwd: () => cwd,
    setCwd: (c) => { cwd = c; },
    vfs,
    registry,
    builtins,
    jobTable: { add: () => 0, list: () => [], get: () => undefined, remove: () => {}, collectDone: () => [] } as any,
    writeToTerminal: (text) => { output += text; },
    aliases,
  });

  return { vfs, env, aliases, interpreter, getOutput: () => output, clearOutput: () => { output = ''; } };
}

describe('source builtin', () => {
  it('executes lines from a file', async () => {
    const { vfs, env, interpreter } = createTestShell();
    vfs.writeFile('/test.sh', 'export FOO=bar\nexport BAZ=qux\n');

    // Simulate source: read file and execute each line
    const content = vfs.readFileString('/test.sh');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      await interpreter.executeLine(trimmed);
    }

    expect(env['FOO']).toBe('bar');
    expect(env['BAZ']).toBe('qux');
  });

  it('skips comments and empty lines', async () => {
    const { vfs, env, interpreter } = createTestShell();
    vfs.writeFile('/test.sh', '# This is a comment\n\nexport HELLO=world\n# another comment\n');

    const content = vfs.readFileString('/test.sh');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      await interpreter.executeLine(trimmed);
    }

    expect(env['HELLO']).toBe('world');
  });
});

describe('alias', () => {
  it('defines and uses an alias', async () => {
    const { interpreter, aliases, getOutput, clearOutput } = createTestShell();

    // Define alias
    await interpreter.executeLine("alias greet=echo");
    expect(aliases.get('greet')).toBe('echo');

    // Use alias
    clearOutput();
    await interpreter.executeLine('greet hello');
    expect(getOutput()).toContain('hello');
  });

  it('lists all aliases with no args', async () => {
    const { interpreter, aliases, getOutput, clearOutput } = createTestShell();

    aliases.set('ll', 'ls -la');
    aliases.set('la', 'ls -a');

    clearOutput();
    await interpreter.executeLine('alias');
    const output = getOutput();
    expect(output).toContain("alias ll='ls -la'");
    expect(output).toContain("alias la='ls -a'");
  });

  it('unalias removes an alias', async () => {
    const { interpreter, aliases } = createTestShell();

    aliases.set('foo', 'echo foo');
    expect(aliases.has('foo')).toBe(true);

    await interpreter.executeLine('unalias foo');
    expect(aliases.has('foo')).toBe(false);
  });

  it('alias expansion passes remaining args', async () => {
    const { interpreter, aliases, getOutput, clearOutput } = createTestShell();

    aliases.set('say', 'echo');
    clearOutput();
    await interpreter.executeLine('say hello world');
    expect(getOutput()).toContain('hello world');
  });
});
