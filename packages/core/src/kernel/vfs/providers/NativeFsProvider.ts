import type { MountProvider, Stat, Dirent } from '../types.js';
import { VFSError, ErrorCode } from '../types.js';

/**
 * Minimal interface for the subset of Node.js `fs` sync methods we need.
 * Consumers pass this in so we avoid a hard dependency on `node:fs`.
 */
export interface NativeFsModule {
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: string | Uint8Array): void;
  existsSync(path: string): boolean;
  statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number; ctimeMs: number; mode: number };
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  unlinkSync(path: string): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  rmdirSync(path: string): void;
  renameSync(oldPath: string, newPath: string): void;
  copyFileSync(src: string, dest: string): void;
}

/**
 * A MountProvider that delegates to a native filesystem via sync Node.js APIs.
 *
 * All subpaths are sandboxed to `rootPath` -- any attempt to escape via `..`
 * is rejected with EINVAL.
 */
export class NativeFsProvider implements MountProvider {
  private rootPath: string;
  private fs: NativeFsModule;
  private readOnly: boolean;

  constructor(rootPath: string, fsModule: NativeFsModule, options?: { readOnly?: boolean }) {
    // Normalize: strip trailing slash unless it's the root itself
    this.rootPath = rootPath.endsWith('/') && rootPath.length > 1
      ? rootPath.slice(0, -1)
      : rootPath;
    this.fs = fsModule;
    this.readOnly = options?.readOnly ?? false;
  }

  // ─── Path sandboxing ───

  private resolveSafe(subpath: string): string {
    // Normalize the subpath: remove leading slash, resolve . and ..
    const clean = subpath.startsWith('/') ? subpath.slice(1) : subpath;
    const parts = clean.split('/').filter(Boolean);
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (resolved.length === 0) {
          throw new VFSError(ErrorCode.EINVAL, `path '${subpath}' escapes mount root`);
        }
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    const relative = resolved.join('/');
    return relative ? `${this.rootPath}/${relative}` : this.rootPath;
  }

  private assertWritable(): void {
    if (this.readOnly) {
      throw new VFSError(ErrorCode.EINVAL, 'filesystem is mounted read-only');
    }
  }

  // ─── Read operations ───

  readFile(subpath: string): Uint8Array {
    const fullPath = this.resolveSafe(subpath);
    try {
      return this.fs.readFileSync(fullPath);
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  readFileString(subpath: string): string {
    const data = this.readFile(subpath);
    return new TextDecoder().decode(data);
  }

  exists(subpath: string): boolean {
    const fullPath = this.resolveSafe(subpath);
    return this.fs.existsSync(fullPath);
  }

  stat(subpath: string): Stat {
    const fullPath = this.resolveSafe(subpath);
    try {
      const s = this.fs.statSync(fullPath);
      return {
        type: s.isDirectory() ? 'directory' : 'file',
        size: s.size,
        ctime: Math.floor(s.ctimeMs),
        mtime: Math.floor(s.mtimeMs),
        mode: s.mode,
      };
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  readdir(subpath: string): Dirent[] {
    const fullPath = this.resolveSafe(subpath);
    try {
      const entries = this.fs.readdirSync(fullPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' as const : 'file' as const,
      }));
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  // ─── Write operations ───

  writeFile(subpath: string, content: string | Uint8Array): void {
    this.assertWritable();
    const fullPath = this.resolveSafe(subpath);
    try {
      this.fs.writeFileSync(fullPath, content);
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  unlink(subpath: string): void {
    this.assertWritable();
    const fullPath = this.resolveSafe(subpath);
    try {
      this.fs.unlinkSync(fullPath);
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  mkdir(subpath: string, options?: { recursive?: boolean }): void {
    this.assertWritable();
    const fullPath = this.resolveSafe(subpath);
    try {
      this.fs.mkdirSync(fullPath, options);
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  rmdir(subpath: string): void {
    this.assertWritable();
    const fullPath = this.resolveSafe(subpath);
    try {
      this.fs.rmdirSync(fullPath);
    } catch (err: unknown) {
      throw this.wrapError(err, subpath);
    }
  }

  rename(oldSubpath: string, newSubpath: string): void {
    this.assertWritable();
    const oldFull = this.resolveSafe(oldSubpath);
    const newFull = this.resolveSafe(newSubpath);
    try {
      this.fs.renameSync(oldFull, newFull);
    } catch (err: unknown) {
      throw this.wrapError(err, newSubpath);
    }
  }

  copyFile(srcSubpath: string, destSubpath: string): void {
    this.assertWritable();
    const srcFull = this.resolveSafe(srcSubpath);
    const destFull = this.resolveSafe(destSubpath);
    try {
      this.fs.copyFileSync(srcFull, destFull);
    } catch (err: unknown) {
      throw this.wrapError(err, destSubpath);
    }
  }

  // ─── Error mapping ───

  private wrapError(err: unknown, subpath: string): VFSError {
    if (err instanceof VFSError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') return new VFSError(ErrorCode.ENOENT, `'${subpath}': ${msg}`);
    if (code === 'EEXIST') return new VFSError(ErrorCode.EEXIST, `'${subpath}': ${msg}`);
    if (code === 'EISDIR') return new VFSError(ErrorCode.EISDIR, `'${subpath}': ${msg}`);
    if (code === 'ENOTDIR') return new VFSError(ErrorCode.ENOTDIR, `'${subpath}': ${msg}`);
    if (code === 'ENOTEMPTY') return new VFSError(ErrorCode.ENOTEMPTY, `'${subpath}': ${msg}`);
    return new VFSError(ErrorCode.EINVAL, `'${subpath}': ${msg}`);
  }
}
