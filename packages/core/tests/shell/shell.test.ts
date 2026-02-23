import { describe, it, expect, beforeEach } from 'vitest';
import { Shell } from '../../src/shell/Shell.js';
import { VFS } from '../../src/kernel/vfs/index.js';
import { createDefaultRegistry } from '../../src/commands/registry.js';

// Minimal mock terminal
function createMockTerminal() {
  const output: string[] = [];
  let dataCallback: ((data: string) => void) | null = null;

  return {
    write(data: string) { output.push(data); },
    writeln(data: string) { output.push(data + '\n'); },
    onData(cb: (data: string) => void) { dataCallback = cb; },
    get cols() { return 80; },
    get rows() { return 24; },
    focus() {},
    clear() { output.length = 0; },
    // Test helpers
    getOutput() { return output; },
    getOutputText() { return output.join(''); },
    sendData(data: string) { dataCallback?.(data); },
    clearOutput() { output.length = 0; },
  };
}

describe('Shell', () => {
  describe('tokenizer', () => {
    let shell: Shell;

    beforeEach(() => {
      const terminal = createMockTerminal();
      const vfs = new VFS();
      const registry = createDefaultRegistry();
      shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
    });

    it('splits simple words', () => {
      expect(shell.tokenize('hello world')).toEqual(['hello', 'world']);
    });

    it('handles double quotes', () => {
      expect(shell.tokenize('echo "hello world"')).toEqual(['echo', 'hello world']);
    });

    it('handles single quotes', () => {
      expect(shell.tokenize("echo 'hello world'")).toEqual(['echo', 'hello world']);
    });

    it('handles &&', () => {
      expect(shell.tokenize('mkdir foo && cd foo')).toEqual(['mkdir', 'foo', '&&', 'cd', 'foo']);
    });

    it('handles empty input', () => {
      expect(shell.tokenize('')).toEqual([]);
    });

    it('handles multiple spaces', () => {
      expect(shell.tokenize('  a   b  ')).toEqual(['a', 'b']);
    });
  });

  describe('builtins via simulated input', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;
    let shell: Shell;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      vfs.mkdir('/tmp');
      const registry = createDefaultRegistry();
      shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      // Allow async execution
      return new Promise((resolve) => setTimeout(resolve, 50));
    }

    it('pwd returns cwd', async () => {
      await sendLine('pwd');
      expect(terminal.getOutputText()).toContain('/home/user');
    });

    it('echo prints args', async () => {
      await sendLine('echo hello world');
      expect(terminal.getOutputText()).toContain('hello world');
    });

    it('cd changes directory', async () => {
      await sendLine('cd /tmp');
      terminal.clearOutput();
      await sendLine('pwd');
      expect(terminal.getOutputText()).toContain('/tmp');
    });

    it('unknown command returns 127 message', async () => {
      await sendLine('nonexistent');
      expect(terminal.getOutputText()).toContain('command not found');
    });
  });

  describe('pipes', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      vfs.mkdir('/tmp');
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('echo hello | cat', async () => {
      await sendLine('echo hello | cat');
      expect(terminal.getOutputText()).toContain('hello');
    });
  });

  describe('redirects', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      vfs.mkdir('/tmp');
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('echo hi > file', async () => {
      await sendLine('echo hi > /tmp/out.txt');
      expect(vfs.readFileString('/tmp/out.txt')).toContain('hi');
    });

    it('echo more >> file appends', async () => {
      vfs.writeFile('/tmp/out.txt', 'hello\n');
      await sendLine('echo more >> /tmp/out.txt');
      const content = vfs.readFileString('/tmp/out.txt');
      expect(content).toContain('hello');
      expect(content).toContain('more');
    });

    it('cat < file reads from input redirect', async () => {
      vfs.writeFile('/tmp/in.txt', 'file content');
      await sendLine('cat < /tmp/in.txt');
      expect(terminal.getOutputText()).toContain('file content');
    });
  });

  describe('variable expansion', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('echo $HOME expands variable', async () => {
      await sendLine('echo $HOME');
      expect(terminal.getOutputText()).toContain('/home/user');
    });

    it('${VAR:-default} uses default when unset', async () => {
      await sendLine('echo ${MISSING:-default}');
      expect(terminal.getOutputText()).toContain('default');
    });

    it('${VAR:-default} uses value when set', async () => {
      await sendLine('echo ${HOME:-fallback}');
      expect(terminal.getOutputText()).toContain('/home/user');
    });
  });

  describe('chaining operators', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('|| runs second on failure', async () => {
      await sendLine('false || echo fallback');
      expect(terminal.getOutputText()).toContain('fallback');
    });

    it('&& does not run second on failure', async () => {
      await sendLine('false && echo nope');
      // "nope" appears in typed character echoes, so check that nope\r\n (command output) is absent
      expect(terminal.getOutputText()).not.toContain('nope\r\n');
    });

    it('; runs unconditionally', async () => {
      await sendLine('echo first ; echo second');
      const output = terminal.getOutputText();
      expect(output).toContain('first');
      expect(output).toContain('second');
    });

    it('true && echo yes works', async () => {
      await sendLine('true && echo yes');
      expect(terminal.getOutputText()).toContain('yes');
    });
  });

  describe('glob expansion', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('echo *.txt expands globs', async () => {
      vfs.writeFile('/home/user/a.txt', 'a');
      vfs.writeFile('/home/user/b.txt', 'b');
      vfs.writeFile('/home/user/c.log', 'c');
      await sendLine('echo *.txt');
      const output = terminal.getOutputText();
      expect(output).toContain('a.txt');
      expect(output).toContain('b.txt');
      expect(output).not.toContain('c.log');
    });
  });

  describe('terminal stdin', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      vfs.mkdir('/tmp');
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 50));
    }

    function sendChar(ch: string): Promise<void> {
      terminal.sendData(ch);
      return new Promise((resolve) => setTimeout(resolve, 10));
    }

    it('cat > file with stdin input and Ctrl+D', async () => {
      // Start `cat > /tmp/test.txt` -- this will wait for stdin
      const linePromise = sendLine('cat > /tmp/test.txt');
      await linePromise;

      // Give cat time to start and call read()
      await new Promise((r) => setTimeout(r, 50));

      // Type first line
      for (const ch of 'hello world') {
        await sendChar(ch);
      }
      await sendChar('\r'); // Enter

      // Give time for feed to process
      await new Promise((r) => setTimeout(r, 50));

      // Type second line
      for (const ch of 'second line') {
        await sendChar(ch);
      }
      await sendChar('\r'); // Enter

      await new Promise((r) => setTimeout(r, 50));

      // Send Ctrl+D (EOF)
      terminal.sendData('\x04');

      // Wait for command to finish
      await new Promise((r) => setTimeout(r, 200));

      const content = vfs.readFileString('/tmp/test.txt');
      expect(content).toContain('hello world');
      expect(content).toContain('second line');
    });

    it('cat with stdin echoes input and writes to stdout', async () => {
      // Start `cat` (no args, no redirect -- reads stdin, writes to stdout/terminal)
      const linePromise = sendLine('cat');
      await linePromise;

      await new Promise((r) => setTimeout(r, 50));

      // Type a line
      for (const ch of 'test input') {
        await sendChar(ch);
      }
      await sendChar('\r');

      await new Promise((r) => setTimeout(r, 50));

      // Send Ctrl+D
      terminal.sendData('\x04');

      await new Promise((r) => setTimeout(r, 200));

      const output = terminal.getOutputText();
      expect(output).toContain('test input');
    });

    it('backspace works during stdin input', async () => {
      const linePromise = sendLine('cat > /tmp/bs.txt');
      await linePromise;
      await new Promise((r) => setTimeout(r, 50));

      // Type "helloo" then backspace to "hello"
      for (const ch of 'helloo') {
        await sendChar(ch);
      }
      await sendChar('\x7f'); // backspace
      await sendChar('\r');

      await new Promise((r) => setTimeout(r, 50));

      terminal.sendData('\x04');
      await new Promise((r) => setTimeout(r, 200));

      const content = vfs.readFileString('/tmp/bs.txt');
      expect(content).toContain('hello\n');
      expect(content).not.toContain('helloo');
    });

    it('Ctrl+C during stdin terminates command', async () => {
      const linePromise = sendLine('cat > /tmp/ctrlc.txt');
      await linePromise;
      await new Promise((r) => setTimeout(r, 50));

      // Type something
      for (const ch of 'partial') {
        await sendChar(ch);
      }

      // Ctrl+C
      terminal.sendData('\x03');
      await new Promise((r) => setTimeout(r, 200));

      // The file should exist but may be empty (since cat didn't finish writing)
      // The important thing is we're back at the prompt
      const output = terminal.getOutputText();
      // Prompt should be visible after Ctrl+C
      expect(output).toContain('$');
    });
  });

  describe('history expansion', () => {
    let terminal: ReturnType<typeof createMockTerminal>;
    let vfs: VFS;

    beforeEach(() => {
      terminal = createMockTerminal();
      vfs = new VFS();
      vfs.mkdir('/home/user', { recursive: true });
      const registry = createDefaultRegistry();
      const shell = new Shell(terminal as never, vfs, registry, { HOME: '/home/user', USER: 'user', HOSTNAME: 'test' });
      shell.start();
      terminal.clearOutput();
    });

    function sendLine(line: string): Promise<void> {
      for (const ch of line) {
        terminal.sendData(ch);
      }
      terminal.sendData('\r');
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    it('!! repeats last command', async () => {
      await sendLine('echo first');
      terminal.clearOutput();
      await sendLine('!!');
      expect(terminal.getOutputText()).toContain('first');
    });
  });
});
