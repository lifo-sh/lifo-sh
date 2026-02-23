import type { VFS } from '../kernel/vfs/index.js';
import { VFSError } from '../kernel/vfs/index.js';
import type { Stat as VfsStat } from '../kernel/vfs/types.js';
import { resolve } from '../utils/path.js';

interface NodeStat {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  isBlockDevice: () => boolean;
  isCharacterDevice: () => boolean;
  isFIFO: () => boolean;
  isSocket: () => boolean;
}

function toNodeStat(stat: VfsStat): NodeStat {
  const isFile = stat.type === 'file';
  const isDir = stat.type === 'directory';
  return {
    dev: 0,
    ino: 0,
    mode: stat.mode,
    nlink: isDir ? 2 : 1,
    uid: 1000,
    gid: 1000,
    rdev: 0,
    size: stat.size,
    blksize: 4096,
    blocks: Math.ceil(stat.size / 512),
    atimeMs: stat.mtime,
    mtimeMs: stat.mtime,
    ctimeMs: stat.ctime,
    birthtimeMs: stat.ctime,
    atime: new Date(stat.mtime),
    mtime: new Date(stat.mtime),
    ctime: new Date(stat.ctime),
    birthtime: new Date(stat.ctime),
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

interface NodeError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path: string;
}

function toNodeError(e: VFSError, syscall: string, path: string): NodeError {
  const err = new Error(e.message) as NodeError;
  err.code = e.code;
  err.errno = -2;
  err.syscall = syscall;
  err.path = path;
  err.name = 'Error';
  return err;
}

type Callback<T> = (err: NodeError | null, result?: T) => void;

function resolvePath(cwd: string, p: string | URL): string {
  const str = typeof p === 'string' ? p : p.pathname;
  return resolve(cwd, str);
}

export function createFs(vfs: VFS, cwd: string) {
  // ─── Sync API ───

  function readFileSync(path: string | URL, options?: string | { encoding?: string; flag?: string }): string | Uint8Array {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const abs = resolvePath(cwd, path);
    if (encoding) {
      return vfs.readFileString(abs);
    }
    return vfs.readFile(abs);
  }

  function writeFileSync(path: string | URL, data: string | Uint8Array, _options?: string | { encoding?: string }): void {
    const abs = resolvePath(cwd, path);
    vfs.writeFile(abs, data);
  }

  function appendFileSync(path: string | URL, data: string | Uint8Array): void {
    const abs = resolvePath(cwd, path);
    vfs.appendFile(abs, data);
  }

  function existsSync(path: string | URL): boolean {
    const abs = resolvePath(cwd, path);
    return vfs.exists(abs);
  }

  function statSync(path: string | URL): NodeStat {
    const abs = resolvePath(cwd, path);
    return toNodeStat(vfs.stat(abs));
  }

  function lstatSync(path: string | URL): NodeStat {
    return statSync(path);
  }

  function mkdirSync(path: string | URL, options?: { recursive?: boolean; mode?: number } | number): void {
    const abs = resolvePath(cwd, path);
    const opts = typeof options === 'number' ? {} : options;
    vfs.mkdir(abs, { recursive: opts?.recursive });
  }

  function readdirSync(path: string | URL, _options?: { encoding?: string; withFileTypes?: boolean }): string[] {
    const abs = resolvePath(cwd, path);
    const entries = vfs.readdir(abs);
    return entries.map((e) => e.name);
  }

  function unlinkSync(path: string | URL): void {
    const abs = resolvePath(cwd, path);
    vfs.unlink(abs);
  }

  function rmdirSync(path: string | URL, options?: { recursive?: boolean }): void {
    const abs = resolvePath(cwd, path);
    if (options?.recursive) {
      vfs.rmdirRecursive(abs);
    } else {
      vfs.rmdir(abs);
    }
  }

  function renameSync(oldPath: string | URL, newPath: string | URL): void {
    const abs1 = resolvePath(cwd, oldPath);
    const abs2 = resolvePath(cwd, newPath);
    vfs.rename(abs1, abs2);
  }

  function copyFileSync(src: string | URL, dest: string | URL): void {
    const abs1 = resolvePath(cwd, src);
    const abs2 = resolvePath(cwd, dest);
    vfs.copyFile(abs1, abs2);
  }

  function chmodSync(_path: string | URL, _mode: number): void {
    // No-op in VFS
  }

  function accessSync(path: string | URL, _mode?: number): void {
    const abs = resolvePath(cwd, path);
    if (!vfs.exists(abs)) {
      const err = new Error(`ENOENT: no such file or directory, access '${abs}'`) as NodeError;
      err.code = 'ENOENT';
      err.errno = -2;
      err.syscall = 'access';
      err.path = abs;
      throw err;
    }
  }

  // ─── Callback API ───

  function wrapCallback<T>(syncFn: () => T, cb: Callback<T>): void {
    queueMicrotask(() => {
      try {
        const result = syncFn();
        cb(null, result);
      } catch (e) {
        if (e instanceof VFSError) {
          cb(toNodeError(e, '', ''));
        } else {
          throw e;
        }
      }
    });
  }

  function readFile(path: string | URL, optionsOrCb: string | { encoding?: string } | Callback<string | Uint8Array>, cb?: Callback<string | Uint8Array>): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb!;
    const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
    wrapCallback(() => readFileSync(path, options), callback);
  }

  function writeFile(path: string | URL, data: string | Uint8Array, optionsOrCb: string | { encoding?: string } | Callback<void>, cb?: Callback<void>): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb!;
    wrapCallback(() => writeFileSync(path, data), callback);
  }

  function stat(path: string | URL, cb: Callback<NodeStat>): void {
    wrapCallback(() => statSync(path), cb);
  }

  function mkdir(path: string | URL, optionsOrCb: { recursive?: boolean } | Callback<void>, cb?: Callback<void>): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb!;
    const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
    wrapCallback(() => mkdirSync(path, options), callback);
  }

  function readdir(path: string | URL, optionsOrCb: { encoding?: string } | Callback<string[]>, cb?: Callback<string[]>): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb!;
    wrapCallback(() => readdirSync(path), callback);
  }

  function unlink(path: string | URL, cb: Callback<void>): void {
    wrapCallback(() => unlinkSync(path), cb);
  }

  function rename(oldPath: string | URL, newPath: string | URL, cb: Callback<void>): void {
    wrapCallback(() => renameSync(oldPath, newPath), cb);
  }

  function access(path: string | URL, modeOrCb: number | Callback<void>, cb?: Callback<void>): void {
    const callback = typeof modeOrCb === 'function' ? modeOrCb : cb!;
    const mode = typeof modeOrCb === 'function' ? undefined : modeOrCb;
    wrapCallback(() => accessSync(path, mode), callback);
  }

  function exists(path: string | URL, cb: (exists: boolean) => void): void {
    queueMicrotask(() => {
      cb(existsSync(path));
    });
  }

  // ─── Promises API ───

  const promises = {
    readFile: async (path: string | URL, options?: string | { encoding?: string }) => readFileSync(path, options),
    writeFile: async (path: string | URL, data: string | Uint8Array) => writeFileSync(path, data),
    appendFile: async (path: string | URL, data: string | Uint8Array) => appendFileSync(path, data),
    stat: async (path: string | URL) => statSync(path),
    lstat: async (path: string | URL) => lstatSync(path),
    mkdir: async (path: string | URL, options?: { recursive?: boolean }) => { mkdirSync(path, options); },
    readdir: async (path: string | URL) => readdirSync(path),
    unlink: async (path: string | URL) => unlinkSync(path),
    rmdir: async (path: string | URL, options?: { recursive?: boolean }) => rmdirSync(path, options),
    rename: async (oldPath: string | URL, newPath: string | URL) => renameSync(oldPath, newPath),
    copyFile: async (src: string | URL, dest: string | URL) => copyFileSync(src, dest),
    access: async (path: string | URL, mode?: number) => accessSync(path, mode),
    rm: async (path: string | URL, options?: { recursive?: boolean; force?: boolean }) => {
      const abs = resolvePath(cwd, path);
      try {
        const s = vfs.stat(abs);
        if (s.type === 'directory') {
          if (options?.recursive) {
            vfs.rmdirRecursive(abs);
          } else {
            vfs.rmdir(abs);
          }
        } else {
          vfs.unlink(abs);
        }
      } catch (e) {
        if (options?.force && e instanceof VFSError && e.code === 'ENOENT') return;
        throw e;
      }
    },
  };

  // ─── Constants ───

  const constants = {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  };

  return {
    // Sync
    readFileSync,
    writeFileSync,
    appendFileSync,
    existsSync,
    statSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    unlinkSync,
    rmdirSync,
    renameSync,
    copyFileSync,
    chmodSync,
    accessSync,
    // Callback
    readFile,
    writeFile,
    stat,
    mkdir,
    readdir,
    unlink,
    rename,
    access,
    exists,
    // Promises
    promises,
    // Constants
    constants,
  };
}
