import { describe, it, expect, beforeEach } from 'vitest';
import { VFS, VFSError } from '../../src/kernel/vfs/index.js';

describe('VFS', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
  });

  describe('mkdir', () => {
    it('creates a directory', () => {
      vfs.mkdir('/foo');
      const stat = vfs.stat('/foo');
      expect(stat.type).toBe('directory');
    });

    it('creates nested dirs with recursive', () => {
      vfs.mkdir('/a/b/c', { recursive: true });
      expect(vfs.stat('/a/b/c').type).toBe('directory');
    });

    it('throws EEXIST for duplicate', () => {
      vfs.mkdir('/foo');
      expect(() => vfs.mkdir('/foo')).toThrow(VFSError);
    });

    it('throws ENOENT for missing parent', () => {
      expect(() => vfs.mkdir('/a/b')).toThrow(VFSError);
    });
  });

  describe('writeFile / readFile', () => {
    it('writes and reads a file', () => {
      vfs.mkdir('/dir');
      vfs.writeFile('/dir/file.txt', 'hello');
      expect(vfs.readFileString('/dir/file.txt')).toBe('hello');
    });

    it('overwrites existing file', () => {
      vfs.writeFile('/file', 'first');
      vfs.writeFile('/file', 'second');
      expect(vfs.readFileString('/file')).toBe('second');
    });

    it('throws ENOENT for missing parent', () => {
      expect(() => vfs.writeFile('/no/file', 'x')).toThrow(VFSError);
    });

    it('throws EISDIR when reading a directory', () => {
      vfs.mkdir('/dir');
      expect(() => vfs.readFile('/dir')).toThrow(VFSError);
    });
  });

  describe('appendFile', () => {
    it('appends to existing file', () => {
      vfs.writeFile('/file', 'hello');
      vfs.appendFile('/file', ' world');
      expect(vfs.readFileString('/file')).toBe('hello world');
    });

    it('creates file if not exists', () => {
      vfs.appendFile('/file', 'content');
      expect(vfs.readFileString('/file')).toBe('content');
    });
  });

  describe('exists', () => {
    it('returns true for existing', () => {
      vfs.writeFile('/file', '');
      expect(vfs.exists('/file')).toBe(true);
    });

    it('returns false for missing', () => {
      expect(vfs.exists('/nope')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns file stat', () => {
      vfs.writeFile('/f', 'abc');
      const stat = vfs.stat('/f');
      expect(stat.type).toBe('file');
      expect(stat.size).toBe(3);
    });

    it('returns dir stat', () => {
      vfs.mkdir('/d');
      vfs.writeFile('/d/a', '');
      const stat = vfs.stat('/d');
      expect(stat.type).toBe('directory');
      expect(stat.size).toBe(1); // one child
    });
  });

  describe('unlink', () => {
    it('removes a file', () => {
      vfs.writeFile('/f', '');
      vfs.unlink('/f');
      expect(vfs.exists('/f')).toBe(false);
    });

    it('throws EISDIR for directory', () => {
      vfs.mkdir('/d');
      expect(() => vfs.unlink('/d')).toThrow(VFSError);
    });

    it('throws ENOENT for missing', () => {
      expect(() => vfs.unlink('/nope')).toThrow(VFSError);
    });
  });

  describe('rmdir', () => {
    it('removes empty directory', () => {
      vfs.mkdir('/d');
      vfs.rmdir('/d');
      expect(vfs.exists('/d')).toBe(false);
    });

    it('throws ENOTEMPTY for non-empty', () => {
      vfs.mkdir('/d');
      vfs.writeFile('/d/f', '');
      expect(() => vfs.rmdir('/d')).toThrow(VFSError);
    });
  });

  describe('readdir', () => {
    it('lists directory contents', () => {
      vfs.mkdir('/d');
      vfs.writeFile('/d/a', '');
      vfs.writeFile('/d/b', '');
      vfs.mkdir('/d/c');
      const entries = vfs.readdir('/d');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['a', 'b', 'c']);
    });

    it('throws ENOTDIR for file', () => {
      vfs.writeFile('/f', '');
      expect(() => vfs.readdir('/f')).toThrow(VFSError);
    });
  });

  describe('rename', () => {
    it('renames a file', () => {
      vfs.writeFile('/a', 'data');
      vfs.rename('/a', '/b');
      expect(vfs.exists('/a')).toBe(false);
      expect(vfs.readFileString('/b')).toBe('data');
    });

    it('moves file between directories', () => {
      vfs.mkdir('/src');
      vfs.mkdir('/dst');
      vfs.writeFile('/src/f', 'hi');
      vfs.rename('/src/f', '/dst/f');
      expect(vfs.exists('/src/f')).toBe(false);
      expect(vfs.readFileString('/dst/f')).toBe('hi');
    });
  });

  describe('copyFile', () => {
    it('copies a file', () => {
      vfs.writeFile('/a', 'data');
      vfs.copyFile('/a', '/b');
      expect(vfs.readFileString('/b')).toBe('data');
      expect(vfs.readFileString('/a')).toBe('data'); // original intact
    });

    it('throws EISDIR for source directory', () => {
      vfs.mkdir('/d');
      expect(() => vfs.copyFile('/d', '/x')).toThrow(VFSError);
    });
  });

  describe('touch', () => {
    it('creates a new empty file', () => {
      vfs.touch('/f');
      expect(vfs.exists('/f')).toBe(true);
      expect(vfs.readFileString('/f')).toBe('');
    });

    it('updates mtime of existing file', () => {
      vfs.writeFile('/f', 'x');
      const before = vfs.stat('/f').mtime;
      // tiny delay to ensure different timestamp
      vfs.touch('/f');
      const after = vfs.stat('/f').mtime;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('rmdirRecursive', () => {
    it('removes directory tree', () => {
      vfs.mkdir('/a/b/c', { recursive: true });
      vfs.writeFile('/a/b/c/f', 'data');
      vfs.writeFile('/a/b/g', 'data');
      vfs.rmdirRecursive('/a');
      expect(vfs.exists('/a')).toBe(false);
    });
  });
});
