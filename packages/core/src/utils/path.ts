/**
 * POSIX path operations -- pure string manipulation, no I/O.
 */

export function normalize(path: string): string {
  if (path === '') return '.';

  const absolute = path.startsWith('/');
  const parts = path.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (!absolute) {
        resolved.push('..');
      }
    } else {
      resolved.push(part);
    }
  }

  let result = resolved.join('/');
  if (absolute) result = '/' + result;
  return result || (absolute ? '/' : '.');
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join('/'));
}

export function resolve(cwd: string, ...segments: string[]): string {
  let result = cwd;
  for (const seg of segments) {
    if (isAbsolute(seg)) {
      result = seg;
    } else {
      result = result + '/' + seg;
    }
  }
  return normalize(result);
}

export function dirname(path: string): string {
  const normalized = normalize(path);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  if (lastSlash === 0) return '/';
  return normalized.slice(0, lastSlash);
}

export function basename(path: string, ext?: string): string {
  const normalized = normalize(path);
  const lastSlash = normalized.lastIndexOf('/');
  let base = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export function extname(path: string): string {
  const base = basename(path);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return base.slice(dotIndex);
}

export function split(path: string): string[] {
  const normalized = normalize(path);
  if (normalized === '/') return ['/'];
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/')) {
    return ['/', ...parts];
  }
  return parts;
}
