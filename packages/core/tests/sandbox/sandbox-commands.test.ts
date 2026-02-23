import { describe, it, expect, afterEach } from 'vitest';
import { Sandbox } from '../../src/sandbox/index.js';

describe('SandboxCommands', () => {
  let sandbox: Sandbox;

  afterEach(() => {
    sandbox?.destroy();
  });

  describe('streaming callbacks', () => {
    it('calls onStdout for each write', async () => {
      sandbox = await Sandbox.create();
      const chunks: string[] = [];
      const result = await sandbox.commands.run('echo hello', {
        onStdout: (data) => chunks.push(data),
      });
      expect(result.stdout).toBe('hello\n');
      expect(chunks.join('')).toBe('hello\n');
    });

    it('calls onStderr for errors', async () => {
      sandbox = await Sandbox.create();
      const stderrChunks: string[] = [];
      const result = await sandbox.commands.run('nonexistent_xyz', {
        onStderr: (data) => stderrChunks.push(data),
      });
      expect(result.exitCode).toBe(127);
      expect(stderrChunks.join('')).toContain('command not found');
    });
  });

  describe('stdin', () => {
    it('provides stdin to cat', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('cat', {
        stdin: 'hello from stdin\n',
      });
      expect(result.stdout).toContain('hello from stdin');
    });

    it('provides stdin to cat > file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.commands.run('cat > /tmp/stdin-test.txt', {
        stdin: 'written via stdin\n',
      });
      const content = await sandbox.fs.readFile('/tmp/stdin-test.txt');
      expect(content).toContain('written via stdin');
    });
  });

  describe('per-call env', () => {
    it('merges env for the call', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo $MY_VAR', {
        env: { MY_VAR: 'hello' },
      });
      expect(result.stdout).toContain('hello');
    });
  });

  describe('register', () => {
    it('registers a custom command', async () => {
      sandbox = await Sandbox.create();
      sandbox.commands.register('greet', async (ctx) => {
        ctx.stdout.write(`Hello, ${ctx.args[0] ?? 'world'}!\n`);
        return 0;
      });
      const result = await sandbox.commands.run('greet Alice');
      expect(result.stdout).toBe('Hello, Alice!\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('complex commands', () => {
    it('variable expansion', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo $HOME');
      expect(result.stdout).toBe('/home/user\n');
    });

    it('command substitution with default values', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo ${MISSING:-fallback}');
      expect(result.stdout).toBe('fallback\n');
    });

    it('semicolon chaining', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo a ; echo b');
      expect(result.stdout).toContain('a');
      expect(result.stdout).toContain('b');
    });

    it('|| operator runs on failure', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('false || echo fallback');
      expect(result.stdout).toContain('fallback');
    });

    it('&& stops on failure', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('false && echo nope');
      expect(result.stdout).not.toContain('nope');
    });
  });
});
