import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { evaluateTest } from '../../src/shell/test-builtin.js';
import type { CommandOutputStream } from '../../src/commands/types.js';

function createVFS(): VFS {
  const vfs = new VFS();
  vfs.mkdir('/tmp');
  vfs.writeFile('/tmp/hello.txt', 'hello world');
  vfs.writeFile('/tmp/empty.txt', '');
  return vfs;
}

function makeStderr(): { stderr: CommandOutputStream; errors: string[] } {
  const errors: string[] = [];
  return {
    stderr: { write: (text: string) => errors.push(text) },
    errors,
  };
}

describe('test builtin', () => {
  describe('string tests', () => {
    it('-z returns 0 for empty string', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-z', ''], vfs, stderr)).toBe(0);
    });

    it('-z returns 1 for non-empty string', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-z', 'hello'], vfs, stderr)).toBe(1);
    });

    it('-n returns 0 for non-empty string', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-n', 'hello'], vfs, stderr)).toBe(0);
    });

    it('-n returns 1 for empty string', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-n', ''], vfs, stderr)).toBe(1);
    });

    it('= compares strings equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['abc', '=', 'abc'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['abc', '=', 'def'], vfs, stderr)).toBe(1);
    });

    it('!= compares strings not equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['abc', '!=', 'def'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['abc', '!=', 'abc'], vfs, stderr)).toBe(1);
    });

    it('single string is true if non-empty', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['hello'], vfs, stderr)).toBe(0);
    });

    it('empty args returns 1', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest([], vfs, stderr)).toBe(1);
    });
  });

  describe('integer tests', () => {
    it('-eq compares integers equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['5', '-eq', '5'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['5', '-eq', '3'], vfs, stderr)).toBe(1);
    });

    it('-ne compares integers not equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['5', '-ne', '3'], vfs, stderr)).toBe(0);
    });

    it('-lt compares less than', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['3', '-lt', '5'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['5', '-lt', '3'], vfs, stderr)).toBe(1);
    });

    it('-le compares less or equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['3', '-le', '3'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['4', '-le', '3'], vfs, stderr)).toBe(1);
    });

    it('-gt compares greater than', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['5', '-gt', '3'], vfs, stderr)).toBe(0);
    });

    it('-ge compares greater or equal', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['3', '-ge', '3'], vfs, stderr)).toBe(0);
    });
  });

  describe('file tests', () => {
    it('-e returns 0 for existing file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-e', '/tmp/hello.txt'], vfs, stderr)).toBe(0);
    });

    it('-e returns 1 for non-existing file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-e', '/tmp/nope.txt'], vfs, stderr)).toBe(1);
    });

    it('-f returns 0 for regular file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-f', '/tmp/hello.txt'], vfs, stderr)).toBe(0);
    });

    it('-d returns 0 for directory', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-d', '/tmp'], vfs, stderr)).toBe(0);
    });

    it('-d returns 1 for regular file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-d', '/tmp/hello.txt'], vfs, stderr)).toBe(1);
    });

    it('-s returns 0 for non-empty file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-s', '/tmp/hello.txt'], vfs, stderr)).toBe(0);
    });

    it('-s returns 1 for empty file', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-s', '/tmp/empty.txt'], vfs, stderr)).toBe(1);
    });
  });

  describe('logical operators', () => {
    it('! negates expression', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['!', '-e', '/tmp/nope.txt'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['!', '-e', '/tmp/hello.txt'], vfs, stderr)).toBe(1);
    });

    it('-a is logical AND', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-e', '/tmp/hello.txt', '-a', '-f', '/tmp/hello.txt'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['-e', '/tmp/hello.txt', '-a', '-e', '/tmp/nope.txt'], vfs, stderr)).toBe(1);
    });

    it('-o is logical OR', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      expect(evaluateTest(['-e', '/tmp/nope.txt', '-o', '-e', '/tmp/hello.txt'], vfs, stderr)).toBe(0);
      expect(evaluateTest(['-e', '/tmp/nope1.txt', '-o', '-e', '/tmp/nope2.txt'], vfs, stderr)).toBe(1);
    });
  });

  describe('[ requires ]', () => {
    it('strips closing ] from args', () => {
      const vfs = createVFS();
      const { stderr } = makeStderr();
      // Simulating [ -e /tmp/hello.txt ] -- the ] is the last arg
      expect(evaluateTest(['-e', '/tmp/hello.txt', ']'], vfs, stderr)).toBe(0);
    });
  });
});
