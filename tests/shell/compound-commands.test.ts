import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import { Interpreter, type BuiltinFn } from '../../src/shell/interpreter.js';
import { evaluateTest } from '../../src/shell/test-builtin.js';

function createTestShell() {
  const vfs = new VFS();
  const registry = new CommandRegistry();
  const env: Record<string, string> = { HOME: '/home/user', USER: 'user' };
  const aliases = new Map<string, string>();
  let cwd = '/';
  let output = '';
  const builtins = new Map<string, BuiltinFn>();

  builtins.set('echo', async (args, stdout) => {
    stdout.write(args.join(' ') + '\n');
    return 0;
  });

  builtins.set('true', async () => 0);
  builtins.set('false', async () => 1);

  builtins.set('export', async (args) => {
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        env[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
      }
    }
    return 0;
  });

  builtins.set('test', async (args, _stdout, stderr) => {
    return evaluateTest(args, vfs, stderr);
  });

  builtins.set('[', async (args, _stdout, stderr) => {
    return evaluateTest(args, vfs, stderr);
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

describe('compound commands', () => {
  describe('if/elif/else/fi', () => {
    it('executes if-then-fi when condition is true', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if true; then echo yes; fi');
      expect(getOutput()).toContain('yes');
    });

    it('skips body when condition is false', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if false; then echo yes; fi');
      expect(getOutput()).not.toContain('yes');
    });

    it('executes else when condition is false', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if false; then echo no; else echo fallback; fi');
      expect(getOutput()).toContain('fallback');
      expect(getOutput()).not.toContain('no');
    });

    it('handles elif', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if false; then echo first; elif true; then echo second; fi');
      expect(getOutput()).toContain('second');
      expect(getOutput()).not.toContain('first');
    });

    it('handles multiple elif branches', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if false; then echo 1; elif false; then echo 2; elif true; then echo 3; fi');
      expect(getOutput()).toContain('3');
      expect(getOutput()).not.toContain('1');
      expect(getOutput()).not.toContain('2');
    });

    it('handles elif with else fallback', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if false; then echo 1; elif false; then echo 2; else echo 3; fi');
      expect(getOutput()).toContain('3');
    });

    it('uses test builtin in condition', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['x'] = '5';
      await interpreter.executeLine('if [ $x -eq 5 ]; then echo matched; fi');
      expect(getOutput()).toContain('matched');
    });

    it('returns 0 when no clause matches and no else', async () => {
      const { interpreter } = createTestShell();
      const code = await interpreter.executeLine('if false; then echo x; fi');
      expect(code).toBe(0);
    });
  });

  describe('for loops', () => {
    it('iterates over a word list', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in a b c; do echo $x; done');
      expect(getOutput()).toContain('a');
      expect(getOutput()).toContain('b');
      expect(getOutput()).toContain('c');
    });

    it('iterates with variable expansion in word list', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['items'] = 'foo';
      await interpreter.executeLine('for x in $items bar; do echo $x; done');
      expect(getOutput()).toContain('foo');
      expect(getOutput()).toContain('bar');
    });

    it('sets the loop variable', async () => {
      const { interpreter, env } = createTestShell();
      await interpreter.executeLine('for x in last; do echo $x; done');
      expect(env['x']).toBe('last');
    });

    it('handles empty word list', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in ; do echo $x; done');
      expect(getOutput()).toBe('');
    });

    it('supports break in for loop', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in a b c; do if [ $x = b ]; then break; fi; echo $x; done');
      expect(getOutput()).toContain('a');
      expect(getOutput()).not.toContain('b');
      expect(getOutput()).not.toContain('c');
    });

    it('supports continue in for loop', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in a b c; do if [ $x = b ]; then continue; fi; echo $x; done');
      expect(getOutput()).toContain('a');
      expect(getOutput()).not.toContain('b');
      expect(getOutput()).toContain('c');
    });
  });

  describe('while loops', () => {
    it('loops while condition is true', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['x'] = '0';
      await interpreter.executeLine('while [ $x -lt 3 ]; do echo $x; x=$(($x+1)); done');
      expect(getOutput()).toContain('0');
      expect(getOutput()).toContain('1');
      expect(getOutput()).toContain('2');
      expect(getOutput()).not.toContain('3');
    });

    it('does not enter body when condition is false', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('while false; do echo never; done');
      expect(getOutput()).not.toContain('never');
    });

    it('supports break in while loop', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['x'] = '0';
      await interpreter.executeLine('while true; do if [ $x -ge 2 ]; then break; fi; echo $x; x=$(($x+1)); done');
      expect(getOutput()).toContain('0');
      expect(getOutput()).toContain('1');
      expect(getOutput()).not.toContain('2');
    });

    it('supports continue in while loop', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['x'] = '0';
      await interpreter.executeLine('while [ $x -lt 4 ]; do x=$(($x+1)); if [ $x -eq 2 ]; then continue; fi; echo $x; done');
      expect(getOutput()).toContain('1');
      expect(getOutput()).not.toContain('2\n');
      expect(getOutput()).toContain('3');
      expect(getOutput()).toContain('4');
    });
  });

  describe('until loops', () => {
    it('loops until condition is true', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['x'] = '0';
      await interpreter.executeLine('until [ $x -ge 3 ]; do echo $x; x=$(($x+1)); done');
      expect(getOutput()).toContain('0');
      expect(getOutput()).toContain('1');
      expect(getOutput()).toContain('2');
      expect(getOutput()).not.toContain('3');
    });

    it('does not enter body when condition is already true', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('until true; do echo never; done');
      expect(getOutput()).not.toContain('never');
    });
  });

  describe('case statements', () => {
    it('matches a literal pattern', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case hello in hello) echo matched;; esac');
      expect(getOutput()).toContain('matched');
    });

    it('matches a glob pattern', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case hello in h*) echo glob;; esac');
      expect(getOutput()).toContain('glob');
    });

    it('uses * as default case', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case xyz in hello) echo no;; *) echo default;; esac');
      expect(getOutput()).toContain('default');
      expect(getOutput()).not.toContain('no');
    });

    it('only executes the first matching pattern', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case hello in h*) echo first;; hello) echo second;; esac');
      expect(getOutput()).toContain('first');
      expect(getOutput()).not.toContain('second');
    });

    it('matches with variable expansion', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['val'] = 'test';
      await interpreter.executeLine('case $val in test) echo ok;; esac');
      expect(getOutput()).toContain('ok');
    });

    it('handles multiple patterns with |', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case world in hello|world) echo multi;; esac');
      expect(getOutput()).toContain('multi');
    });

    it('returns 0 when no pattern matches', async () => {
      const { interpreter } = createTestShell();
      const code = await interpreter.executeLine('case nomatch in hello) echo x;; esac');
      expect(code).toBe(0);
    });
  });

  describe('function definitions and calls', () => {
    it('defines and calls a function', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('greet() { echo hello; }; greet');
      expect(getOutput()).toContain('hello');
    });

    it('passes arguments as positional parameters', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('greet() { echo "Hello $1"; }; greet World');
      expect(getOutput()).toContain('Hello World');
    });

    it('sets $# correctly', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('count() { echo $#; }; count a b c');
      expect(getOutput()).toContain('3');
    });

    it('sets $@ correctly', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('all() { echo $@; }; all x y z');
      expect(getOutput()).toContain('x y z');
    });

    it('restores positional parameters after function call', async () => {
      const { interpreter, env } = createTestShell();
      env['1'] = 'outer';
      await interpreter.executeLine('f() { echo $1; }; f inner');
      expect(env['1']).toBe('outer');
    });

    it('supports return from function', async () => {
      const { interpreter } = createTestShell();
      const code = await interpreter.executeLine('f() { return 42; }; f');
      expect(code).toBe(42);
    });

    it('function can call another function', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('inner() { echo inner; }; outer() { inner; }; outer');
      expect(getOutput()).toContain('inner');
    });
  });

  describe('group commands', () => {
    it('executes a group command', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('{ echo hello; echo world; }');
      expect(getOutput()).toContain('hello');
      expect(getOutput()).toContain('world');
    });

    it('group returns exit code of last command', async () => {
      const { interpreter } = createTestShell();
      const code = await interpreter.executeLine('{ true; false; }');
      expect(code).toBe(1);
    });
  });

  describe('nested compound commands', () => {
    it('if inside for', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in a b c; do if [ $x = b ]; then echo found; fi; done');
      expect(getOutput()).toContain('found');
    });

    it('for inside if', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if true; then for x in 1 2; do echo $x; done; fi');
      expect(getOutput()).toContain('1');
      expect(getOutput()).toContain('2');
    });

    it('while inside function', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['n'] = '0';
      await interpreter.executeLine('f() { while [ $n -lt 3 ]; do echo $n; n=$(($n+1)); done; }; f');
      expect(getOutput()).toContain('0');
      expect(getOutput()).toContain('1');
      expect(getOutput()).toContain('2');
    });

    it('case inside for', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in yes no; do case $x in yes) echo got-yes;; no) echo got-no;; esac; done');
      expect(getOutput()).toContain('got-yes');
      expect(getOutput()).toContain('got-no');
    });
  });

  describe('multiline parsing', () => {
    it('parses if-then on multiple lines', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('if true\nthen\necho yes\nfi');
      expect(getOutput()).toContain('yes');
    });

    it('parses for loop on multiple lines', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('for x in a b\ndo\necho $x\ndone');
      expect(getOutput()).toContain('a');
      expect(getOutput()).toContain('b');
    });

    it('parses while on multiple lines', async () => {
      const { interpreter, env, getOutput } = createTestShell();
      env['i'] = '0';
      await interpreter.executeLine('while [ $i -lt 2 ]\ndo\necho $i\ni=$(($i+1))\ndone');
      expect(getOutput()).toContain('0');
      expect(getOutput()).toContain('1');
    });

    it('parses case on multiple lines', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('case hello in\nhello)\necho yes\n;;\nesac');
      expect(getOutput()).toContain('yes');
    });
  });

  describe('echo keyword as argument', () => {
    it('echo if does not start a conditional', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('echo if');
      expect(getOutput()).toContain('if');
    });

    it('echo for does not start a loop', async () => {
      const { interpreter, getOutput } = createTestShell();
      await interpreter.executeLine('echo for');
      expect(getOutput()).toContain('for');
    });
  });
});
