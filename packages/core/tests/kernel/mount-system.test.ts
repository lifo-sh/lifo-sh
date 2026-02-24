import { describe, it, expect, beforeEach } from 'vitest';
import { VFS, VFSError } from '../../src/kernel/vfs/index.js';
import { NativeFsProvider } from '../../src/kernel/vfs/providers/NativeFsProvider.js';
import type { NativeFsModule } from '../../src/kernel/vfs/providers/NativeFsProvider.js';
import type { VirtualProvider, Stat, Dirent } from '../../src/kernel/vfs/types.js';
import { ErrorCode } from '../../src/kernel/vfs/types.js';
import { encode } from '../../src/utils/encoding.js';

// ─── In-memory mock of NativeFsModule ───

interface MockFile {
  type: 'file';
  data: Uint8Array;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface MockDir {
  type: 'dir';
  children: Map<string, MockFile | MockDir>;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
}

type MockEntry = MockFile | MockDir;

function createMockFs(): { fs: NativeFsModule; tree: MockDir } {
  const tree: MockDir = {
    type: 'dir',
    children: new Map(),
    mode: 0o755,
    mtimeMs: 1000,
    ctimeMs: 1000,
  };

  function resolvePath(p: string): { parent: MockDir; name: string } | null {
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const name = parts.pop()!;
    let current: MockEntry = tree;
    for (const part of parts) {
      if (current.type !== 'dir') return null;
      const child = current.children.get(part);
      if (!child) return null;
      current = child;
    }
    if (current.type !== 'dir') return null;
    return { parent: current, name };
  }

  function resolveEntry(p: string): MockEntry | null {
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 0) return tree;
    let current: MockEntry = tree;
    for (const part of parts) {
      if (current.type !== 'dir') return null;
      const child = current.children.get(part);
      if (!child) return null;
      current = child;
    }
    return current;
  }

  const fs: NativeFsModule = {
    readFileSync(path: string): Uint8Array {
      const entry = resolveEntry(path);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (entry.type !== 'file') throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
      return entry.data;
    },

    writeFileSync(path: string, data: string | Uint8Array): void {
      const r = resolvePath(path);
      if (!r) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      const bytes = typeof data === 'string' ? encode(data) : data;
      const existing = r.parent.children.get(r.name);
      if (existing && existing.type === 'dir') {
        throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
      }
      r.parent.children.set(r.name, {
        type: 'file',
        data: new Uint8Array(bytes),
        mode: 0o644,
        mtimeMs: Date.now(),
        ctimeMs: existing ? (existing as MockFile).ctimeMs : Date.now(),
      });
    },

    existsSync(path: string): boolean {
      return resolveEntry(path) !== null;
    },

    statSync(path: string) {
      const entry = resolveEntry(path);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return {
        isFile: () => entry.type === 'file',
        isDirectory: () => entry.type === 'dir',
        size: entry.type === 'file' ? entry.data.length : (entry as MockDir).children.size,
        mtimeMs: entry.mtimeMs,
        ctimeMs: entry.ctimeMs,
        mode: entry.mode,
      };
    },

    readdirSync(path: string, _options: { withFileTypes: true }) {
      const entry = resolveEntry(path);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (entry.type !== 'dir') throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: 'ENOTDIR' });
      return Array.from(entry.children.entries()).map(([name, child]) => ({
        name,
        isFile: () => child.type === 'file',
        isDirectory: () => child.type === 'dir',
      }));
    },

    unlinkSync(path: string): void {
      const r = resolvePath(path);
      if (!r) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      const entry = r.parent.children.get(r.name);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (entry.type === 'dir') throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
      r.parent.children.delete(r.name);
    },

    mkdirSync(path: string, options?: { recursive?: boolean }): void {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean);
        let current: MockEntry = tree;
        for (const part of parts) {
          if (current.type !== 'dir') throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: 'ENOTDIR' });
          let child = current.children.get(part);
          if (!child) {
            child = { type: 'dir', children: new Map(), mode: 0o755, mtimeMs: Date.now(), ctimeMs: Date.now() };
            current.children.set(part, child);
          }
          current = child;
        }
        return;
      }
      const r = resolvePath(path);
      if (!r) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (r.parent.children.has(r.name)) {
        throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
      }
      r.parent.children.set(r.name, {
        type: 'dir', children: new Map(), mode: 0o755, mtimeMs: Date.now(), ctimeMs: Date.now(),
      });
    },

    rmdirSync(path: string): void {
      const r = resolvePath(path);
      if (!r) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      const entry = r.parent.children.get(r.name);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      if (entry.type !== 'dir') throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: 'ENOTDIR' });
      if ((entry as MockDir).children.size > 0) {
        throw Object.assign(new Error(`ENOTEMPTY: ${path}`), { code: 'ENOTEMPTY' });
      }
      r.parent.children.delete(r.name);
    },

    renameSync(oldPath: string, newPath: string): void {
      const rOld = resolvePath(oldPath);
      if (!rOld) throw Object.assign(new Error(`ENOENT: ${oldPath}`), { code: 'ENOENT' });
      const entry = rOld.parent.children.get(rOld.name);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${oldPath}`), { code: 'ENOENT' });
      const rNew = resolvePath(newPath);
      if (!rNew) throw Object.assign(new Error(`ENOENT: ${newPath}`), { code: 'ENOENT' });
      rOld.parent.children.delete(rOld.name);
      rNew.parent.children.set(rNew.name, entry);
    },

    copyFileSync(src: string, dest: string): void {
      const srcEntry = resolveEntry(src);
      if (!srcEntry) throw Object.assign(new Error(`ENOENT: ${src}`), { code: 'ENOENT' });
      if (srcEntry.type !== 'file') throw Object.assign(new Error(`EISDIR: ${src}`), { code: 'EISDIR' });
      const rDest = resolvePath(dest);
      if (!rDest) throw Object.assign(new Error(`ENOENT: ${dest}`), { code: 'ENOENT' });
      rDest.parent.children.set(rDest.name, {
        type: 'file',
        data: new Uint8Array(srcEntry.data),
        mode: srcEntry.mode,
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
      });
    },
  };

  return { fs, tree };
}

// ─── Helper: simple read-only VirtualProvider ───

function createSimpleProvider(files: Record<string, string>): VirtualProvider {
  return {
    readFile(subpath: string): Uint8Array {
      const key = subpath.startsWith('/') ? subpath : '/' + subpath;
      const content = files[key];
      if (content === undefined) throw new VFSError(ErrorCode.ENOENT, subpath);
      return encode(content);
    },
    readFileString(subpath: string): string {
      const key = subpath.startsWith('/') ? subpath : '/' + subpath;
      const content = files[key];
      if (content === undefined) throw new VFSError(ErrorCode.ENOENT, subpath);
      return content;
    },
    exists(subpath: string): boolean {
      const key = subpath.startsWith('/') ? subpath : '/' + subpath;
      return key === '/' || files[key] !== undefined;
    },
    stat(subpath: string): Stat {
      const key = subpath.startsWith('/') ? subpath : '/' + subpath;
      if (key === '/') return { type: 'directory', size: 0, ctime: 0, mtime: 0, mode: 0o755 };
      if (files[key] !== undefined) {
        return { type: 'file', size: files[key].length, ctime: 0, mtime: 0, mode: 0o644 };
      }
      throw new VFSError(ErrorCode.ENOENT, subpath);
    },
    readdir(subpath: string): Dirent[] {
      const key = subpath.startsWith('/') ? subpath : '/' + subpath;
      if (key !== '/') throw new VFSError(ErrorCode.ENOTDIR, subpath);
      return Object.keys(files).map((k) => ({
        name: k.slice(1),
        type: 'file' as const,
      }));
    },
  };
}

// ─── Tests ───

describe('Mount System', () => {
  describe('VFS mount/unmount', () => {
    let vfs: VFS;

    beforeEach(() => {
      vfs = new VFS();
    });

    it('mount registers a provider and readdir shows it', () => {
      const provider = createSimpleProvider({ '/info': 'hello' });
      vfs.mount('/mnt/data', provider);

      const entries = vfs.readdir('/');
      expect(entries.some((e) => e.name === 'mnt')).toBe(true);
    });

    it('mount at nested path shows intermediate dirs', () => {
      const provider = createSimpleProvider({ '/readme': 'hi' });
      vfs.mount('/mnt/project/code', provider);

      const rootEntries = vfs.readdir('/');
      expect(rootEntries.some((e) => e.name === 'mnt')).toBe(true);

      // /mnt does not actually exist in VFS, but the mount injects it
      // Reading from the mounted path works
      expect(vfs.readFileString('/mnt/project/code/readme')).toBe('hi');
    });

    it('registerProvider is backward compatible with mount', () => {
      const provider = createSimpleProvider({ '/status': 'ok' });
      vfs.registerProvider('/sys', provider);

      expect(vfs.readFileString('/sys/status')).toBe('ok');
      expect(vfs.exists('/sys')).toBe(true);
    });

    it('unmount removes the provider', () => {
      const provider = createSimpleProvider({ '/data': 'x' });
      vfs.mount('/mnt/usb', provider);
      expect(vfs.readFileString('/mnt/usb/data')).toBe('x');

      vfs.unmount('/mnt/usb');
      expect(() => vfs.readFile('/mnt/usb/data')).toThrow(VFSError);
    });

    it('unmount throws for non-existent mount', () => {
      expect(() => vfs.unmount('/not/mounted')).toThrow(VFSError);
    });

    it('most specific mount wins (longest prefix)', () => {
      const outer = createSimpleProvider({ '/file.txt': 'outer' });
      const inner = createSimpleProvider({ '/file.txt': 'inner' });

      vfs.mount('/mnt', outer);
      vfs.mount('/mnt/deep', inner);

      // /mnt/deep/file.txt should resolve to the inner provider
      expect(vfs.readFileString('/mnt/deep/file.txt')).toBe('inner');
      // /mnt/file.txt should resolve to the outer provider
      expect(vfs.readFileString('/mnt/file.txt')).toBe('outer');
    });

    it('re-mounting at same path replaces the provider', () => {
      const p1 = createSimpleProvider({ '/ver': 'v1' });
      const p2 = createSimpleProvider({ '/ver': 'v2' });

      vfs.mount('/info', p1);
      expect(vfs.readFileString('/info/ver')).toBe('v1');

      vfs.mount('/info', p2);
      expect(vfs.readFileString('/info/ver')).toBe('v2');
    });
  });

  describe('VFS write delegation to MountProvider', () => {
    let vfs: VFS;
    let mockFsResult: ReturnType<typeof createMockFs>;

    beforeEach(() => {
      vfs = new VFS();
      mockFsResult = createMockFs();
    });

    it('writeFile delegates to MountProvider', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      // Create the /root directory in mock fs
      mockFsResult.fs.mkdirSync('/root', { recursive: true });
      vfs.mount('/mnt', provider);

      vfs.writeFile('/mnt/test.txt', 'hello');
      expect(vfs.readFileString('/mnt/test.txt')).toBe('hello');
    });

    it('unlink delegates to MountProvider', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      mockFsResult.fs.mkdirSync('/root', { recursive: true });
      mockFsResult.fs.writeFileSync('/root/file.txt', 'data');
      vfs.mount('/mnt', provider);

      expect(vfs.exists('/mnt/file.txt')).toBe(true);
      vfs.unlink('/mnt/file.txt');
      expect(vfs.exists('/mnt/file.txt')).toBe(false);
    });

    it('mkdir delegates to MountProvider', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      mockFsResult.fs.mkdirSync('/root', { recursive: true });
      vfs.mount('/mnt', provider);

      vfs.mkdir('/mnt/subdir');
      const entries = vfs.readdir('/mnt');
      expect(entries.some((e) => e.name === 'subdir')).toBe(true);
    });

    it('rmdir delegates to MountProvider', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      mockFsResult.fs.mkdirSync('/root/subdir', { recursive: true });
      vfs.mount('/mnt', provider);

      expect(vfs.exists('/mnt/subdir')).toBe(true);
      vfs.rmdir('/mnt/subdir');
      expect(vfs.exists('/mnt/subdir')).toBe(false);
    });

    it('rename delegates to MountProvider when both paths on same mount', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      mockFsResult.fs.mkdirSync('/root', { recursive: true });
      mockFsResult.fs.writeFileSync('/root/old.txt', 'content');
      vfs.mount('/mnt', provider);

      vfs.rename('/mnt/old.txt', '/mnt/new.txt');
      expect(vfs.exists('/mnt/old.txt')).toBe(false);
      expect(vfs.readFileString('/mnt/new.txt')).toBe('content');
    });

    it('copyFile delegates to MountProvider when both paths on same mount', () => {
      const provider = new NativeFsProvider('/root', mockFsResult.fs);
      mockFsResult.fs.mkdirSync('/root', { recursive: true });
      mockFsResult.fs.writeFileSync('/root/src.txt', 'data');
      vfs.mount('/mnt', provider);

      vfs.copyFile('/mnt/src.txt', '/mnt/dst.txt');
      expect(vfs.readFileString('/mnt/src.txt')).toBe('data');
      expect(vfs.readFileString('/mnt/dst.txt')).toBe('data');
    });

    it('unlink on read-only VirtualProvider throws', () => {
      const provider = createSimpleProvider({ '/file': 'data' });
      vfs.mount('/ro', provider);
      expect(() => vfs.unlink('/ro/file')).toThrow(VFSError);
    });

    it('mkdir on read-only VirtualProvider throws', () => {
      const provider = createSimpleProvider({});
      vfs.mount('/ro', provider);
      expect(() => vfs.mkdir('/ro/newdir')).toThrow(VFSError);
    });

    it('rmdir on read-only VirtualProvider throws', () => {
      const provider = createSimpleProvider({});
      vfs.mount('/ro', provider);
      expect(() => vfs.rmdir('/ro/somedir')).toThrow(VFSError);
    });
  });

  describe('NativeFsProvider', () => {
    it('reads files from the native fs mock', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/hello.txt', 'world');

      const provider = new NativeFsProvider('/project', fs);
      expect(provider.readFileString('/hello.txt')).toBe('world');
    });

    it('checks existence', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/a.txt', 'x');

      const provider = new NativeFsProvider('/project', fs);
      expect(provider.exists('/a.txt')).toBe(true);
      expect(provider.exists('/b.txt')).toBe(false);
    });

    it('returns correct stat', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project/sub', { recursive: true });
      fs.writeFileSync('/project/file.txt', 'abc');

      const provider = new NativeFsProvider('/project', fs);

      const fileStat = provider.stat('/file.txt');
      expect(fileStat.type).toBe('file');
      expect(fileStat.size).toBe(3);

      const dirStat = provider.stat('/sub');
      expect(dirStat.type).toBe('directory');
    });

    it('lists directory entries', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/a.txt', '');
      fs.writeFileSync('/project/b.txt', '');
      fs.mkdirSync('/project/sub');

      const provider = new NativeFsProvider('/project', fs);
      const entries = provider.readdir('/');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt', 'sub']);
    });

    it('writes and reads back a file', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });

      const provider = new NativeFsProvider('/project', fs);
      provider.writeFile('/new.txt', 'content');
      expect(provider.readFileString('/new.txt')).toBe('content');
    });

    it('creates and removes directories', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });

      const provider = new NativeFsProvider('/project', fs);
      provider.mkdir('/newdir');
      expect(provider.exists('/newdir')).toBe(true);

      provider.rmdir('/newdir');
      expect(provider.exists('/newdir')).toBe(false);
    });

    it('unlinks files', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/temp.txt', 'x');

      const provider = new NativeFsProvider('/project', fs);
      expect(provider.exists('/temp.txt')).toBe(true);
      provider.unlink('/temp.txt');
      expect(provider.exists('/temp.txt')).toBe(false);
    });

    it('renames files', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/old.txt', 'data');

      const provider = new NativeFsProvider('/project', fs);
      provider.rename('/old.txt', '/new.txt');
      expect(provider.exists('/old.txt')).toBe(false);
      expect(provider.readFileString('/new.txt')).toBe('data');
    });

    it('copies files', () => {
      const { fs } = createMockFs();
      fs.mkdirSync('/project', { recursive: true });
      fs.writeFileSync('/project/src.txt', 'hello');

      const provider = new NativeFsProvider('/project', fs);
      provider.copyFile('/src.txt', '/dst.txt');
      expect(provider.readFileString('/dst.txt')).toBe('hello');
      expect(provider.readFileString('/src.txt')).toBe('hello'); // original intact
    });

    describe('path sandboxing', () => {
      it('rejects paths that escape the root via ..', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });

        const provider = new NativeFsProvider('/project', fs);
        expect(() => provider.readFile('/../etc/passwd')).toThrow(VFSError);
        expect(() => provider.readFile('/../../etc/shadow')).toThrow(VFSError);
      });

      it('allows .. that stays within the root', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project/sub', { recursive: true });
        fs.writeFileSync('/project/file.txt', 'ok');

        const provider = new NativeFsProvider('/project', fs);
        expect(provider.readFileString('/sub/../file.txt')).toBe('ok');
      });

      it('handles deeply nested escapes', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });

        const provider = new NativeFsProvider('/project', fs);
        expect(() => provider.readFile('/a/b/../../../../etc/passwd')).toThrow(VFSError);
      });
    });

    describe('readOnly mode', () => {
      it('allows read operations', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        fs.writeFileSync('/project/readme.txt', 'read me');

        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(provider.readFileString('/readme.txt')).toBe('read me');
        expect(provider.exists('/readme.txt')).toBe(true);
      });

      it('blocks writeFile', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.writeFile('/x.txt', 'data')).toThrow(VFSError);
      });

      it('blocks unlink', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        fs.writeFileSync('/project/file.txt', 'x');
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.unlink('/file.txt')).toThrow(VFSError);
      });

      it('blocks mkdir', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.mkdir('/newdir')).toThrow(VFSError);
      });

      it('blocks rmdir', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project/sub', { recursive: true });
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.rmdir('/sub')).toThrow(VFSError);
      });

      it('blocks rename', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        fs.writeFileSync('/project/a.txt', 'x');
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.rename('/a.txt', '/b.txt')).toThrow(VFSError);
      });

      it('blocks copyFile', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        fs.writeFileSync('/project/a.txt', 'x');
        const provider = new NativeFsProvider('/project', fs, { readOnly: true });
        expect(() => provider.copyFile('/a.txt', '/b.txt')).toThrow(VFSError);
      });
    });

    describe('error mapping', () => {
      it('maps ENOENT from native fs', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project', { recursive: true });
        const provider = new NativeFsProvider('/project', fs);

        try {
          provider.readFile('/nonexistent.txt');
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VFSError);
          expect((err as VFSError).code).toBe('ENOENT');
        }
      });

      it('maps EISDIR from native fs', () => {
        const { fs } = createMockFs();
        fs.mkdirSync('/project/dir', { recursive: true });
        const provider = new NativeFsProvider('/project', fs);

        try {
          provider.readFile('/dir');
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VFSError);
          expect((err as VFSError).code).toBe('EISDIR');
        }
      });
    });
  });

  describe('readdir injection for deep mounts', () => {
    let vfs: VFS;

    beforeEach(() => {
      vfs = new VFS();
    });

    it('injects intermediate directories at root level', () => {
      const provider = createSimpleProvider({ '/data': 'x' });
      vfs.mount('/custom/deep/path', provider);

      const rootEntries = vfs.readdir('/');
      expect(rootEntries.some((e) => e.name === 'custom')).toBe(true);
    });

    it('injects intermediate directories at intermediate levels', () => {
      const provider = createSimpleProvider({ '/data': 'x' });
      vfs.mkdir('/mnt');
      vfs.mount('/mnt/project/src', provider);

      const mntEntries = vfs.readdir('/mnt');
      expect(mntEntries.some((e) => e.name === 'project')).toBe(true);
    });

    it('does not duplicate existing directory entries', () => {
      vfs.mkdir('/mnt');
      vfs.mkdir('/mnt/real');
      const provider = createSimpleProvider({ '/data': 'x' });
      vfs.mount('/mnt/real', provider);

      const mntEntries = vfs.readdir('/mnt');
      const realCount = mntEntries.filter((e) => e.name === 'real').length;
      expect(realCount).toBe(1);
    });
  });

  describe('cross-mount copyFile', () => {
    it('copies data from a provider to in-memory VFS', () => {
      const vfs = new VFS();
      const { fs } = createMockFs();
      fs.mkdirSync('/ext', { recursive: true });
      fs.writeFileSync('/ext/data.txt', 'external content');

      const provider = new NativeFsProvider('/ext', fs, { readOnly: true });
      vfs.mount('/mnt/ext', provider);
      vfs.mkdir('/home');

      // Copy from mounted provider to in-memory VFS
      vfs.copyFile('/mnt/ext/data.txt', '/home/copy.txt');
      expect(vfs.readFileString('/home/copy.txt')).toBe('external content');
    });
  });
});
