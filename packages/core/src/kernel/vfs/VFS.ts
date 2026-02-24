import { resolve, dirname, basename } from '../../utils/path.js';
import { encode, decode } from '../../utils/encoding.js';
import { getMimeType } from '../../utils/mime.js';
import { INode, Stat, Dirent, VFSError, ErrorCode, VirtualProvider, MountProvider } from './types.js';
import type { VFSWatchEvent, VFSWatchListener } from './types.js';
import { ContentStore, CHUNK_THRESHOLD } from '../storage/ContentStore.js';
import { EventEmitter } from '../../node-compat/events.js';

/** Runtime check: does a provider implement the full MountProvider interface? */
function isMountProvider(p: VirtualProvider): p is MountProvider {
  return (
    typeof (p as MountProvider).unlink === 'function' &&
    typeof (p as MountProvider).mkdir === 'function' &&
    typeof (p as MountProvider).rmdir === 'function' &&
    typeof (p as MountProvider).rename === 'function' &&
    typeof (p as MountProvider).copyFile === 'function'
  );
}

interface MountEntry {
  path: string;            // normalised absolute path, e.g. "/mnt/project"
  provider: VirtualProvider | MountProvider;
}

export class VFS {
  private root: INode;
  /**
   * Mount table -- kept sorted longest-prefix-first so that the first match
   * during lookup is always the most specific.
   */
  private mounts: MountEntry[] = [];
  private emitter = new EventEmitter();
  onChange?: () => void;

  /** Content store for chunked large files. Optional -- without it all data stays inline. */
  readonly contentStore: ContentStore;

  constructor(contentStore?: ContentStore) {
    this.root = this.createNode('directory', '');
    this.contentStore = contentStore ?? new ContentStore();
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

  // ─── Mount management ───

  /**
   * Mount a provider at an arbitrary path.
   * The path is normalised to an absolute path (e.g. "/mnt/project").
   */
  mount(path: string, provider: VirtualProvider | MountProvider): void {
    const abs = this.toAbsolute(path);

    // Replace if already mounted at this exact path
    const idx = this.mounts.findIndex((m) => m.path === abs);
    if (idx !== -1) {
      this.mounts[idx] = { path: abs, provider };
    } else {
      this.mounts.push({ path: abs, provider });
    }

    // Re-sort: longest path first (most specific wins)
    this.mounts.sort((a, b) => b.path.length - a.path.length);
  }

  /**
   * Unmount the provider at the given path.
   */
  unmount(path: string): void {
    const abs = this.toAbsolute(path);
    const idx = this.mounts.findIndex((m) => m.path === abs);
    if (idx === -1) {
      throw new VFSError(ErrorCode.EINVAL, `'${path}': not mounted`);
    }
    this.mounts.splice(idx, 1);
  }

  /**
   * Backward-compatible alias for `mount`.
   * Previously the only way to register a VirtualProvider at a root-level prefix.
   */
  registerProvider(prefix: string, provider: VirtualProvider): void {
    this.mount(prefix, provider);
  }

  getRoot(): INode {
    return this.root;
  }

  loadFromSerialized(root: INode): void {
    this.root = root;
  }

  // ─── Provider resolution ───

  private getProvider(path: string): { provider: VirtualProvider | MountProvider; subpath: string } | null {
    const abs = this.toAbsolute(path);
    for (const entry of this.mounts) {
      if (abs === entry.path || abs.startsWith(entry.path + '/')) {
        const subpath = abs === entry.path ? '/' : abs.slice(entry.path.length);
        return { provider: entry.provider, subpath };
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

    // Chunked file: reassemble from content store
    if (node.chunks) {
      const data = this.contentStore.loadChunked(node.chunks);
      if (data) return data;
      // Chunks evicted from cache -- data is lost (should not happen in normal use)
      return new Uint8Array(0);
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
    const mime = getMimeType(name);
    const existing = parent.children.get(name);

    if (existing) {
      if (existing.type === 'directory') {
        throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
      }
      // Clean up old chunks if transitioning from chunked
      if (existing.chunks) {
        this.contentStore.deleteChunked(existing.chunks);
      }
      this.applyFileContent(existing, data);
      existing.mtime = Date.now();
      existing.mime = mime;
      this.notify({ type: 'modify', path: abs, fileType: 'file' });
    } else {
      const node = this.createNode('file', name);
      this.applyFileContent(node, data);
      node.mime = mime;
      parent.children.set(name, node);
      this.notify({ type: 'create', path: abs, fileType: 'file' });
    }
  }

  /**
   * Store file content -- inline for small files, chunked for large files.
   */
  private applyFileContent(node: INode, data: Uint8Array): void {
    if (data.byteLength >= CHUNK_THRESHOLD) {
      // Large file: chunk into content store
      node.chunks = this.contentStore.storeChunked(data);
      node.storedSize = data.byteLength;
      node.data = new Uint8Array(0); // keep INode lightweight
      node.blobRef = undefined;
    } else {
      // Small file: store inline
      node.data = data;
      node.chunks = undefined;
      node.storedSize = undefined;
      node.blobRef = undefined;
    }
  }

  appendFile(path: string, content: string | Uint8Array): void {
    const data = typeof content === 'string' ? encode(content) : content;
    try {
      const node = this.resolveNode(path);
      if (node.type === 'directory') {
        throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
      }

      if (node.chunks) {
        // Chunked file: read existing, concatenate, re-chunk
        const existing = this.contentStore.loadChunked(node.chunks) ?? new Uint8Array(0);
        const merged = new Uint8Array(existing.byteLength + data.byteLength);
        merged.set(existing, 0);
        merged.set(data, existing.byteLength);
        this.contentStore.deleteChunked(node.chunks);
        this.applyFileContent(node, merged);
      } else {
        // Inline file: concatenate, possibly promote to chunked
        const merged = new Uint8Array(node.data.length + data.length);
        merged.set(node.data, 0);
        merged.set(data, node.data.length);
        this.applyFileContent(node, merged);
      }

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
    const stat: Stat = {
      type: node.type,
      size: node.type === 'file' ? (node.storedSize ?? node.data.length) : node.children.size,
      ctime: node.ctime,
      mtime: node.mtime,
      mode: node.mode,
    };
    if (node.mime) {
      stat.mime = node.mime;
    }
    return stat;
  }

  unlink(path: string): void {
    const abs = this.toAbsolute(path);
    const vp = this.getProvider(path);
    if (vp) {
      if (isMountProvider(vp.provider)) {
        vp.provider.unlink(vp.subpath);
        return;
      }
      throw new VFSError(ErrorCode.EINVAL, `'${path}': read-only virtual filesystem`);
    }

    const { parent, name } = this.resolveParent(path);
    const node = parent.children.get(name);

    if (!node) {
      throw new VFSError(ErrorCode.ENOENT, `'${path}': no such file or directory`);
    }
    if (node.type === 'directory') {
      throw new VFSError(ErrorCode.EISDIR, `'${path}': is a directory`);
    }

    // Clean up chunks from content store
    if (node.chunks) {
      this.contentStore.deleteChunked(node.chunks);
    }

    parent.children.delete(name);
    this.notify({ type: 'delete', path: abs, fileType: 'file' });
  }

  rename(oldPath: string, newPath: string): void {
    const oldAbs = this.toAbsolute(oldPath);
    const newAbs = this.toAbsolute(newPath);
    const vpOld = this.getProvider(oldPath);
    const vpNew = this.getProvider(newPath);

    // If both paths are on the same mount and it supports MountProvider, delegate
    if (vpOld && vpNew && vpOld.provider === vpNew.provider && isMountProvider(vpOld.provider)) {
      vpOld.provider.rename(vpOld.subpath, vpNew.subpath);
      return;
    }

    // If either path is on a provider that doesn't support rename, fall through
    // to in-memory rename (or error if source is on a provider)
    if (vpOld) {
      throw new VFSError(ErrorCode.EINVAL, `'${oldPath}': cannot rename across mount boundaries`);
    }

    const { parent: oldParent, name: oldName } = this.resolveParent(oldPath);
    const node = oldParent.children.get(oldName);

    if (!node) {
      throw new VFSError(ErrorCode.ENOENT, `'${oldPath}': no such file or directory`);
    }

    if (vpNew) {
      throw new VFSError(ErrorCode.EINVAL, `'${newPath}': cannot rename across mount boundaries`);
    }

    const { parent: newParent, name: newName } = this.resolveParent(newPath);
    node.name = newName;
    node.mtime = Date.now();
    newParent.children.set(newName, node);
    oldParent.children.delete(oldName);
    this.notify({ type: 'rename', path: newAbs, oldPath: oldAbs, fileType: node.type });
  }

  copyFile(src: string, dest: string): void {
    const vpSrc = this.getProvider(src);
    const vpDest = this.getProvider(dest);

    // If both on the same MountProvider, delegate
    if (vpSrc && vpDest && vpSrc.provider === vpDest.provider && isMountProvider(vpSrc.provider)) {
      vpSrc.provider.copyFile(vpSrc.subpath, vpDest.subpath);
      return;
    }

    // Otherwise, read from source and write to dest (works across mounts)
    const srcData = this.readFile(src);
    const data = new Uint8Array(srcData);
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
    const vp = this.getProvider(path);
    if (vp) {
      if (isMountProvider(vp.provider)) {
        vp.provider.mkdir(vp.subpath, options);
        return;
      }
      throw new VFSError(ErrorCode.EINVAL, `'${path}': read-only virtual filesystem`);
    }

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
    const vp = this.getProvider(path);
    if (vp) {
      if (isMountProvider(vp.provider)) {
        vp.provider.rmdir(vp.subpath);
        return;
      }
      throw new VFSError(ErrorCode.EINVAL, `'${path}': read-only virtual filesystem`);
    }

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

    // Inject mount point directories that are direct children of the current path
    const abs = this.toAbsolute(path);
    const prefix = abs === '/' ? '/' : abs + '/';

    for (const mount of this.mounts) {
      let candidate: string | null = null;

      if (abs === '/') {
        // At root: inject first segment of each mount path
        if (mount.path.startsWith('/') && mount.path !== '/') {
          const segments = mount.path.slice(1).split('/');
          candidate = segments[0];
        }
      } else if (mount.path.startsWith(prefix)) {
        // At a deeper directory: inject the next path segment after the prefix
        const remainder = mount.path.slice(prefix.length);
        const segments = remainder.split('/');
        candidate = segments[0];
      }

      if (candidate && !entries.some((e) => e.name === candidate)) {
        entries.push({ name: candidate, type: 'directory' });
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

    return Array.from(node.children.values()).map((child) => {
      const entry: Dirent & Stat = {
        name: child.name,
        type: child.type,
        size: child.type === 'file' ? (child.storedSize ?? child.data.length) : child.children.size,
        ctime: child.ctime,
        mtime: child.mtime,
        mode: child.mode,
      };
      if (child.mime) {
        entry.mime = child.mime;
      }
      return entry;
    });
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
