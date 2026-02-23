import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import { Interpreter, type BuiltinFn } from '../../src/shell/interpreter.js';

function createTestShell() {
  const vfs = new VFS();
  const registry = new CommandRegistry();
  const env: Record<string, string> = { HOME: '/home/user', USER: 'user' };
  let cwd = '/';
  let output = '';
  const builtins = new Map<string, BuiltinFn>();

  builtins.set('echo', async (args, stdout) => {
    stdout.write(args.join(' ') + '\n');
    return 0;
  });

  builtins.set('true', async () => 0);
  builtins.set('false', async () => 1);

  const interpreter = new Interpreter({
    env,
    getCwd: () => cwd,
    setCwd: (c) => { cwd = c; },
    vfs,
    registry,
    builtins,
    jobTable: { add: () => 0, list: () => [], get: () => undefined, remove: () => {}, collectDone: () => [] } as any,
    writeToTerminal: (text) => { output += text; },
  });

  return { vfs, env, interpreter, getOutput: () => output, clearOutput: () => { output = ''; } };
}

describe('arithmetic expansion', () => {
  it('evaluates simple addition', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((2+3))');
    expect(getOutput().trim()).toBe('5');
  });

  it('evaluates multiplication', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((4*5))');
    expect(getOutput().trim()).toBe('20');
  });

  it('evaluates precedence correctly', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((2 + 3 * 4))');
    expect(getOutput().trim()).toBe('14');
  });

  it('evaluates parenthesized expressions', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $(( (2 + 3) * 4 ))');
    expect(getOutput().trim()).toBe('20');
  });

  it('evaluates division', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((10 / 3))');
    expect(getOutput().trim()).toBe('3');
  });

  it('evaluates modulo', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((10 % 3))');
    expect(getOutput().trim()).toBe('1');
  });

  it('evaluates exponentiation', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((2 ** 8))');
    expect(getOutput().trim()).toBe('256');
  });

  it('evaluates variable references', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['x'] = '10';
    await interpreter.executeLine('echo $((x / 2))');
    expect(getOutput().trim()).toBe('5');
  });

  it('evaluates subtraction', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((10 - 3))');
    expect(getOutput().trim()).toBe('7');
  });

  it('evaluates negation', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((-5))');
    expect(getOutput().trim()).toBe('-5');
  });

  it('evaluates comparison operators', async () => {
    const { interpreter, getOutput, clearOutput } = createTestShell();
    await interpreter.executeLine('echo $((3 > 2))');
    expect(getOutput().trim()).toBe('1');
    clearOutput();
    await interpreter.executeLine('echo $((3 < 2))');
    expect(getOutput().trim()).toBe('0');
  });

  it('evaluates equality', async () => {
    const { interpreter, getOutput, clearOutput } = createTestShell();
    await interpreter.executeLine('echo $((5 == 5))');
    expect(getOutput().trim()).toBe('1');
    clearOutput();
    await interpreter.executeLine('echo $((5 != 5))');
    expect(getOutput().trim()).toBe('0');
  });

  it('evaluates logical operators', async () => {
    const { interpreter, getOutput, clearOutput } = createTestShell();
    await interpreter.executeLine('echo $((1 && 1))');
    expect(getOutput().trim()).toBe('1');
    clearOutput();
    await interpreter.executeLine('echo $((1 && 0))');
    expect(getOutput().trim()).toBe('0');
    clearOutput();
    await interpreter.executeLine('echo $((0 || 1))');
    expect(getOutput().trim()).toBe('1');
  });

  it('evaluates ternary operator', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((1 ? 10 : 20))');
    expect(getOutput().trim()).toBe('10');
  });

  it('evaluates bitwise operators', async () => {
    const { interpreter, getOutput, clearOutput } = createTestShell();
    await interpreter.executeLine('echo $((5 & 3))');
    expect(getOutput().trim()).toBe('1');
    clearOutput();
    await interpreter.executeLine('echo $((5 | 3))');
    expect(getOutput().trim()).toBe('7');
    clearOutput();
    await interpreter.executeLine('echo $((5 ^ 3))');
    expect(getOutput().trim()).toBe('6');
  });

  it('evaluates shift operators', async () => {
    const { interpreter, getOutput, clearOutput } = createTestShell();
    await interpreter.executeLine('echo $((1 << 3))');
    expect(getOutput().trim()).toBe('8');
    clearOutput();
    await interpreter.executeLine('echo $((8 >> 2))');
    expect(getOutput().trim()).toBe('2');
  });

  it('handles assignment within arithmetic', async () => {
    const { interpreter, env } = createTestShell();
    await interpreter.executeLine('echo $((x=5))');
    expect(env['x']).toBe('5');
  });

  it('handles unset variables as 0', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo $((unset_var + 3))');
    expect(getOutput().trim()).toBe('3');
  });
});

describe('advanced parameter expansion', () => {
  it('${#VAR} returns string length', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['var'] = 'hello world';
    await interpreter.executeLine('echo ${#var}');
    expect(getOutput().trim()).toBe('11');
  });

  it('${VAR#pattern} removes shortest prefix', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['path'] = '/home/user/file.txt';
    await interpreter.executeLine('echo ${path#*/}');
    expect(getOutput().trim()).toBe('home/user/file.txt');
  });

  it('${VAR##pattern} removes longest prefix', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['path'] = '/home/user/file.txt';
    await interpreter.executeLine('echo ${path##*/}');
    expect(getOutput().trim()).toBe('file.txt');
  });

  it('${VAR%pattern} removes shortest suffix', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['file'] = 'image.tar.gz';
    await interpreter.executeLine('echo ${file%.*}');
    expect(getOutput().trim()).toBe('image.tar');
  });

  it('${VAR%%pattern} removes longest suffix', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['file'] = 'image.tar.gz';
    await interpreter.executeLine('echo ${file%%.*}');
    expect(getOutput().trim()).toBe('image');
  });

  it('${VAR/pattern/replacement} replaces first occurrence', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['str'] = 'hello hello world';
    await interpreter.executeLine('echo ${str/hello/goodbye}');
    expect(getOutput().trim()).toBe('goodbye hello world');
  });

  it('${VAR//pattern/replacement} replaces all occurrences', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['str'] = 'aXbXc';
    await interpreter.executeLine('echo ${str//X/-}');
    expect(getOutput().trim()).toBe('a-b-c');
  });

  it('${VAR:offset} returns substring from offset', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['str'] = 'hello world';
    await interpreter.executeLine('echo ${str:6}');
    expect(getOutput().trim()).toBe('world');
  });

  it('${VAR:offset:length} returns substring with length', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['str'] = 'hello world';
    await interpreter.executeLine('echo ${str:0:5}');
    expect(getOutput().trim()).toBe('hello');
  });

  it('${VAR:=default} assigns default when unset', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    await interpreter.executeLine('echo ${myvar:=defaultval}');
    expect(getOutput().trim()).toBe('defaultval');
    expect(env['myvar']).toBe('defaultval');
  });

  it('${VAR:=default} keeps value when set', async () => {
    const { interpreter, env, getOutput } = createTestShell();
    env['myvar'] = 'existing';
    await interpreter.executeLine('echo ${myvar:=defaultval}');
    expect(getOutput().trim()).toBe('existing');
  });

  it('${#VAR} returns 0 for unset variable', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('echo ${#unset}');
    expect(getOutput().trim()).toBe('0');
  });
});

describe('positional parameters', () => {
  it('$1 through $9 in function', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('f() { echo $1 $2 $3; }; f a b c');
    expect(getOutput().trim()).toBe('a b c');
  });

  it('$# in function', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('f() { echo $#; }; f a b c d');
    expect(getOutput().trim()).toBe('4');
  });

  it('$@ in function', async () => {
    const { interpreter, getOutput } = createTestShell();
    await interpreter.executeLine('f() { echo $@; }; f hello world');
    expect(getOutput().trim()).toBe('hello world');
  });
});
