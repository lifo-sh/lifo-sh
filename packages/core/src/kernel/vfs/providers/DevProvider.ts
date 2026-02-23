import type { VirtualProvider, Stat, Dirent } from '../types.js';
import { VFSError, ErrorCode } from '../types.js';
import { encode } from '../../../utils/encoding.js';

const DEVICE_NAMES = ['null', 'zero', 'random', 'urandom', 'clipboard'];

export class DevProvider implements VirtualProvider {
  private clipboardCache = '';

  readFile(subpath: string): Uint8Array {
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;

    switch (name) {
      case 'null':
        return new Uint8Array(0);
      case 'zero':
        return new Uint8Array(1024);
      case 'random':
      case 'urandom': {
        const buf = new Uint8Array(256);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          crypto.getRandomValues(buf);
        }
        return buf;
      }
      case 'clipboard':
        return encode(this.clipboardCache);
      default:
        throw new VFSError(ErrorCode.ENOENT, `'/dev${subpath}': no such device`);
    }
  }

  readFileString(subpath: string): string {
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;

    switch (name) {
      case 'null':
        return '';
      case 'zero':
        return '\0'.repeat(1024);
      case 'random':
      case 'urandom': {
        const buf = new Uint8Array(256);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          crypto.getRandomValues(buf);
        }
        return Array.from(buf).map((b) => String.fromCharCode(b)).join('');
      }
      case 'clipboard':
        return this.clipboardCache;
      default:
        throw new VFSError(ErrorCode.ENOENT, `'/dev${subpath}': no such device`);
    }
  }

  writeFile(subpath: string, content: string | Uint8Array): void {
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;

    switch (name) {
      case 'null':
        // Discard
        return;
      case 'clipboard': {
        const text = typeof content === 'string'
          ? content
          : new TextDecoder().decode(content);
        this.clipboardCache = text;
        // Fire-and-forget clipboard write
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        return;
      }
      default:
        throw new VFSError(ErrorCode.EINVAL, `'/dev${subpath}': cannot write to device`);
    }
  }

  exists(subpath: string): boolean {
    if (subpath === '/') return true;
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;
    return DEVICE_NAMES.includes(name);
  }

  stat(subpath: string): Stat {
    if (!this.exists(subpath)) {
      throw new VFSError(ErrorCode.ENOENT, `'/dev${subpath}': no such device`);
    }

    if (subpath === '/') {
      return { type: 'directory', size: DEVICE_NAMES.length, ctime: 0, mtime: 0, mode: 0o755 };
    }

    return { type: 'file', size: 0, ctime: 0, mtime: 0, mode: 0o666 };
  }

  readdir(subpath: string): Dirent[] {
    if (subpath === '/') {
      return DEVICE_NAMES.map((name) => ({ name, type: 'file' as const }));
    }

    throw new VFSError(ErrorCode.ENOTDIR, `'/dev${subpath}': not a directory`);
  }
}
