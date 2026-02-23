import { describe, it, expect, afterEach } from 'vitest';
import { Sandbox } from '../../src/sandbox/index.js';

describe('SandboxFs', () => {
  let sandbox: Sandbox;

  afterEach(() => {
    sandbox?.destroy();
  });

  describe('readFile / writeFile', () => {
    it('writes and reads a string file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/test.txt', 'hello world');
      const content = await sandbox.fs.readFile('/tmp/test.txt');
      expect(content).toBe('hello world');
    });

    it('writes and reads a binary file', async () => {
      sandbox = await Sandbox.create();
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      await sandbox.fs.writeFile('/tmp/bin.dat', data);
      const result = await sandbox.fs.readFile('/tmp/bin.dat', null);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(72);
    });
  });

  describe('readdir', () => {
    it('lists directory contents', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/a.txt', 'a');
      await sandbox.fs.writeFile('/tmp/b.txt', 'b');
      const entries = await sandbox.fs.readdir('/tmp');
      const names = entries.map((e) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
    });

    it('returns correct types', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/file.txt', 'content');
      await sandbox.fs.mkdir('/tmp/subdir');
      const entries = await sandbox.fs.readdir('/tmp');
      const file = entries.find((e) => e.name === 'file.txt');
      const dir = entries.find((e) => e.name === 'subdir');
      expect(file?.type).toBe('file');
      expect(dir?.type).toBe('directory');
    });
  });

  describe('stat', () => {
    it('returns file stats', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/stat-test.txt', 'hello');
      const s = await sandbox.fs.stat('/tmp/stat-test.txt');
      expect(s.type).toBe('file');
      expect(s.size).toBe(5);
      expect(s.mtime).toBeGreaterThan(0);
    });

    it('returns directory stats', async () => {
      sandbox = await Sandbox.create();
      const s = await sandbox.fs.stat('/tmp');
      expect(s.type).toBe('directory');
    });
  });

  describe('mkdir', () => {
    it('creates a directory', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.mkdir('/tmp/newdir');
      const s = await sandbox.fs.stat('/tmp/newdir');
      expect(s.type).toBe('directory');
    });

    it('creates nested directories recursively', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.mkdir('/tmp/a/b/c', { recursive: true });
      expect(await sandbox.fs.exists('/tmp/a/b/c')).toBe(true);
    });
  });

  describe('rm', () => {
    it('removes a file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/rm-test.txt', 'delete me');
      expect(await sandbox.fs.exists('/tmp/rm-test.txt')).toBe(true);
      await sandbox.fs.rm('/tmp/rm-test.txt');
      expect(await sandbox.fs.exists('/tmp/rm-test.txt')).toBe(false);
    });

    it('removes a directory recursively', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.mkdir('/tmp/rmdir-test');
      await sandbox.fs.writeFile('/tmp/rmdir-test/file.txt', 'content');
      await sandbox.fs.rm('/tmp/rmdir-test', { recursive: true });
      expect(await sandbox.fs.exists('/tmp/rmdir-test')).toBe(false);
    });
  });

  describe('exists', () => {
    it('returns true for existing paths', async () => {
      sandbox = await Sandbox.create();
      expect(await sandbox.fs.exists('/home/user')).toBe(true);
    });

    it('returns false for non-existing paths', async () => {
      sandbox = await Sandbox.create();
      expect(await sandbox.fs.exists('/nonexistent')).toBe(false);
    });
  });

  describe('rename', () => {
    it('renames a file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/old.txt', 'content');
      await sandbox.fs.rename('/tmp/old.txt', '/tmp/new.txt');
      expect(await sandbox.fs.exists('/tmp/old.txt')).toBe(false);
      expect(await sandbox.fs.readFile('/tmp/new.txt')).toBe('content');
    });
  });

  describe('cp', () => {
    it('copies a file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFile('/tmp/src.txt', 'copy me');
      await sandbox.fs.cp('/tmp/src.txt', '/tmp/dest.txt');
      expect(await sandbox.fs.readFile('/tmp/dest.txt')).toBe('copy me');
      // Original still exists
      expect(await sandbox.fs.readFile('/tmp/src.txt')).toBe('copy me');
    });
  });

  describe('writeFiles', () => {
    it('writes multiple files at once', async () => {
      sandbox = await Sandbox.create();
      await sandbox.fs.writeFiles([
        { path: '/tmp/f1.txt', content: 'file 1' },
        { path: '/tmp/f2.txt', content: 'file 2' },
        { path: '/tmp/f3.txt', content: 'file 3' },
      ]);
      expect(await sandbox.fs.readFile('/tmp/f1.txt')).toBe('file 1');
      expect(await sandbox.fs.readFile('/tmp/f2.txt')).toBe('file 2');
      expect(await sandbox.fs.readFile('/tmp/f3.txt')).toBe('file 3');
    });
  });
});
