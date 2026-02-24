import { resolve, dirname, basename } from '../../utils/path.js';
import { encode, decode } from '../../utils/encoding.js';
import { INode, Stat, Dirent, VFSError, ErrorCode, VirtualProvider } from './types.js';
import type { VFSWatchEvent, VFSWatchListener } from './types.js';
import { EventEmitter } from '../../node-compat/events.js';

export class VFS {
  private root: INode;
  private virtualProviders = new Map<string, VirtualProvider>();
  private emitter = new EventEmitter();
  onChange?: () => void;

  constructor() {
    this.root = this.createNode('directory', '');
  }

  // ─── Watch API ───

  watch(listener: VFSWatchListener): () => void;
  watch(path: string, listener: VFSWatchListener): () => void;
  watch(pathOrListener: string | VFSWatchListener, maybeListener?: VFSWatchListener): () => void {
    if (typeof pathOrListener === 'function') {
      // watch(listener) — global watch
      const listener = pathOrListener;
      this.emitter.on('change', listener as (...args: unknown[]) => void);
      return () => this.emitter.off('change', listener as (...args: unknown[]) => void);
    }

    // watch(path, listener) — scoped watch
    const prefix = this.toAbsolute(pathOrListener);
    const listener = maybeListener!;
    const scoped = (event: VFSWatchEvent) => {
      if (event.path === prefix || event.path.startsWith(prefix + '/')) {
        listener(event);
      }
      if (event.oldPath && (event.oldPath === prefix || event.oldPath.startsWith(prefix + '/'))) {
        listener(event);
      }
    };
    this.emitter.on('change', scoped as (...args: unknown[]) => void);
    return () => this.emitter.off('change', scoped as (...args: unknown[]) => void);
  }

  private notify(event: VFSWatchEvent): void {
    this.emitter.emit('change', event);
    this.onChange?.();
  }

  registerProvider(prefix: string, provider: VirtualProvider): void {
    this.virtualProviders.set(prefix, provider);
  }

  getRoot(): INode {
    return this.root;
  }

  loadFromSerialized(root: INode): void {
    this.root = root;
  }

  private getProvider(path: string): { provider: VirtualProvider; subpath: string } | null {
    const abs = this.toAbsolute(path);
    for (const [prefix, provider] of this.virtualProviders) {
      if (abs === prefix || abs.startsWith(prefix + '/')) {
        const subpath = abs === prefix ? '/' : abs.slice(prefix.length);
        return { provider, subpath };
      }
    }
    return null;
  }

  // ─── Internal helpers ───

  private createNode(type: 'file' | 'directory', name: string): INode {
    const now = Date.now();
    return {
      type,
      name,
      data: new Uint8Array(0),
      children: new Map(),
      ctime: now,
      mtime: now,
      mode: type === 'directory' ? 0o755 : 0o644,
    };
  }

  private resolveNode(path: string): INode {
    const abs = this.toAbsolute(path);
    if (abs === '/') return this.root;

    const parts = abs.split('/').filter(Boolean);
    let node = this.root;

    for (const part of parts) {
      if (node.type !== 'directory') {
        throw new VFSError(ErrorCode.ENOTDIR, `'${path}': not a directory`);
      }
      const child = node.children.get(part);
      if (!child) {
        throw new VFSError(ErrorCode.ENOENT, `'${path}': no such file or directory`);
      }
      node = child;
    }

    return node;
  }

  private resolveParent(path: string): { parent: INode; name: string } {
    const abs = this.toAbsolute(path);
    const dir = dirname(abs);
    const name = basename(abs);
    const parent = this.resolveNode(dir);

    if (parent.type !== 'directory') {
      throw new VFSError(ErrorCode.ENOTDIR, `'${dir}': not a directory`);
    }

    return { parent, name };
  }

  private toAbsolute(path: string): string {
    return resolve('/', path);
  }

  // ─── File operations ───

  readFile(path: string): Uint8Array {
    const vp = this.getProvider(path);
    if (vp) return vp.provider.readFile(vp.subpath);

    const node = this.resolveNode(path);
    if (node.type === 'directory') {
      throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
    }
    return node.data;
  }

  readFileString(path: string): string {
    const vp = this.getProvider(path);
    if (vp) return vp.provider.readFileString(vp.subpath);

    return decode(this.readFile(path));
  }

  writeFile(path: string, content: string | Uint8Array): void {
    const vp = this.getProvider(path);
    if (vp) {
      if (vp.provider.writeFile) {
        vp.provider.writeFile(vp.subpath, content);
        return;
      }
      throw new VFSError(ErrorCode.EINVAL, `'${path}': read-only virtual filesystem`);
    }

    const data = typeof content === 'string' ? encode(content) : content;
    const abs = this.toAbsolute(path);
    const { parent, name } = this.resolveParent(path);
    const existing = parent.children.get(name);

    if (existing) {
      if (existing.type === 'directory') {
        throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
      }
      existing.data = data;
      existing.mtime = Date.now();
      this.notify({ type: 'modify', path: abs, fileType: 'file' });
    } else {
      const node = this.createNode('file', name);
      node.data = data;
      parent.children.set(name, node);
      this.notify({ type: 'create', path: abs, fileType: 'file' });
    }
  }

  appendFile(path: string, content: string | Uint8Array): void {
    const data = typeof content === 'string' ? encode(content) : content;
    try {
      const node = this.resolveNode(path);
      if (node.type === 'directory') {
        throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
      }
      const merged = new Uint8Array(node.data.length + data.length);
      merged.set(node.data, 0);
      merged.set(data, node.data.length);
      node.data = merged;
      node.mtime = Date.now();
      this.notify({ type: 'modify', path: this.toAbsolute(path), fileType: 'file' });
    } catch (e) {
      if (e instanceof VFSError && e.code === 'ENOENT') {
        this.writeFile(path, data);
      } else {
        throw e;
      }
    }
  }

  exists(path: string): boolean {
    const vp = this.getProvider(path);
    if (vp) return vp.provider.exists(vp.subpath);

    try {
      this.resolveNode(path);
      return true;
    } catch {
      return false;
    }
  }

  stat(path: string): Stat {
    const vp = this.getProvider(path);
    if (vp) return vp.provider.stat(vp.subpath);

    const node = this.resolveNode(path);
    return {
      type: node.type,
      size: node.type === 'file' ? node.data.length : node.children.size,
      ctime: node.ctime,
      mtime: node.mtime,
      mode: node.mode,
    };
  }

  unlink(path: string): void {
    const abs = this.toAbsolute(path);
    const { parent, name } = this.resolveParent(path);
    const node = parent.children.get(name);

    if (!node) {
      throw new VFSError(ErrorCode.ENOENT, `'${path}': no such file or directory`);
    }
    if (node.type === 'directory') {
      throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
    }

    parent.children.delete(name);
    this.notify({ type: 'delete', path: abs, fileType: 'file' });
  }

  rename(oldPath: string, newPath: string): void {
    const oldAbs = this.toAbsolute(oldPath);
    const newAbs = this.toAbsolute(newPath);
    const { parent: oldParent, name: oldName } = this.resolveParent(oldPath);
    const node = oldParent.children.get(oldName);

    if (!node) {
      throw new VFSError(ErrorCode.ENOENT, `'${oldPath}': no such file or directory`);
    }

    const { parent: newParent, name: newName } = this.resolveParent(newPath);
    node.name = newName;
    node.mtime = Date.now();
    newParent.children.set(newName, node);
    oldParent.children.delete(oldName);
    this.notify({ type: 'rename', path: newAbs, oldPath: oldAbs, fileType: node.type });
  }

  copyFile(src: string, dest: string): void {
    const srcNode = this.resolveNode(src);
    if (srcNode.type === 'directory') {
      throw new VFSError(ErrorCode.EISDIR, `'${src}': is a directory`);
    }

    const data = new Uint8Array(srcNode.data);
    this.writeFile(dest, data); // writeFile already calls notify
  }

  touch(path: string): void {
    try {
      const node = this.resolveNode(path);
      node.mtime = Date.now();
      this.notify({ type: 'modify', path: this.toAbsolute(path), fileType: node.type });
    } catch (e) {
      if (e instanceof VFSError && e.code === 'ENOENT') {
        this.writeFile(path, ''); // writeFile already calls notify
      } else {
        throw e;
      }
    }
  }

  // ─── Directory operations ───

  mkdir(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      const abs = this.toAbsolute(path);
      const parts = abs.split('/').filter(Boolean);
      let current = this.root;
      let currentPath = '';

      for (const part of parts) {
        currentPath += '/' + part;
        let child = current.children.get(part);
        if (!child) {
          child = this.createNode('directory', part);
          current.children.set(part, child);
          this.notify({ type: 'create', path: currentPath, fileType: 'directory' });
        } else if (child.type !== 'directory') {
          throw new VFSError(ErrorCode.ENOTDIR, `'${part}': not a directory`);
        }
        current = child;
      }
      return;
    }

    const abs = this.toAbsolute(path);
    const { parent, name } = this.resolveParent(path);

    if (parent.children.has(name)) {
      throw new VFSError(ErrorCode.EEXIST, `'${path}': file exists`);
    }

    const node = this.createNode('directory', name);
    parent.children.set(name, node);
    this.notify({ type: 'create', path: abs, fileType: 'directory' });
  }

  rmdir(path: string): void {
    const abs = this.toAbsolute(path);
    const { parent, name } = this.resolveParent(path);
    const node = parent.children.get(name);

    if (!node) {
      throw new VFSError(ErrorCode.ENOENT, `'${path}': no such file or directory`);
    }
    if (node.type !== 'directory') {
      throw new VFSError(ErrorCode.ENOTDIR, `'${path}': not a directory`);
    }
    if (node.children.size > 0) {
      throw new VFSError(ErrorCode.ENOTEMPTY, `'${path}': directory not empty`);
    }

    parent.children.delete(name);
    this.notify({ type: 'delete', path: abs, fileType: 'directory' });
  }

  readdir(path: string): Dirent[] {
    const vp = this.getProvider(path);
    if (vp) return vp.provider.readdir(vp.subpath);

    const node = this.resolveNode(path);
    if (node.type !== 'directory') {
      throw new VFSError(ErrorCode.ENOTDIR, `'${path}': not a directory`);
    }

    const entries = Array.from(node.children.values()).map((child) => ({
      name: child.name,
      type: child.type,
    }));

    // Inject virtual provider directories at root level
    if (this.toAbsolute(path) === '/') {
      for (const prefix of this.virtualProviders.keys()) {
        const dirName = prefix.slice(1); // e.g., '/proc' -> 'proc'
        if (!dirName.includes('/') && !entries.some((e) => e.name === dirName)) {
          entries.push({ name: dirName, type: 'directory' });
        }
      }
    }

    return entries;
  }

  readdirStat(path: string): Array<Dirent & Stat> {
    const vp = this.getProvider(path);
    if (vp) {
      return vp.provider.readdir(vp.subpath).map((d) => {
        const childSubpath = vp.subpath === '/' ? `/${d.name}` : `${vp.subpath}/${d.name}`;
        const s = vp.provider.stat(childSubpath);
        return { ...d, ...s };
      });
    }

    const node = this.resolveNode(path);
    if (node.type !== 'directory') {
      throw new VFSError(ErrorCode.ENOTDIR, `'${path}': not a directory`);
    }

    return Array.from(node.children.values()).map((child) => ({
      name: child.name,
      type: child.type,
      size: child.type === 'file' ? child.data.length : child.children.size,
      ctime: child.ctime,
      mtime: child.mtime,
      mode: child.mode,
    }));
  }

  /**
   * Recursively remove a directory and all its contents.
   */
  rmdirRecursive(path: string): void {
    const node = this.resolveNode(path);
    if (node.type !== 'directory') {
      throw new VFSError(ErrorCode.ENOTDIR, `'${path}': not a directory`);
    }

    const abs = this.toAbsolute(path);
    for (const child of node.children.values()) {
      const childPath = abs === '/' ? `/${child.name}` : `${abs}/${child.name}`;
      if (child.type === 'directory') {
        this.rmdirRecursive(childPath);
      } else {
        this.unlink(childPath);
      }
    }
    this.rmdir(abs);
  }
}
