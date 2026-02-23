import type { VFS } from '../kernel/vfs/index.js';
import { resolve } from './path.js';

/**
 * Match a glob pattern against a text string.
 * Supports: * ? [abc] [!abc] [a-z]
 */
export function globMatch(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let starTi = -1;

  while (ti < text.length) {
    if (pi < pattern.length && pattern[pi] === '[') {
      const result = matchCharClass(pattern, pi, text[ti]);
      if (result.matched) {
        pi = result.end;
        ti++;
        continue;
      }
      // No match in char class
      if (starPi >= 0) {
        pi = starPi + 1;
        starTi++;
        ti = starTi;
        continue;
      }
      return false;
    }

    if (pi < pattern.length && pattern[pi] === '?') {
      pi++;
      ti++;
      continue;
    }

    if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi;
      starTi = ti;
      pi++;
      continue;
    }

    if (pi < pattern.length && pattern[pi] === text[ti]) {
      pi++;
      ti++;
      continue;
    }

    if (starPi >= 0) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
      continue;
    }

    return false;
  }

  while (pi < pattern.length && pattern[pi] === '*') {
    pi++;
  }

  return pi === pattern.length;
}

function matchCharClass(pattern: string, pos: number, ch: string): { matched: boolean; end: number } {
  let i = pos + 1; // skip [
  let negate = false;

  if (i < pattern.length && (pattern[i] === '!' || pattern[i] === '^')) {
    negate = true;
    i++;
  }

  let matched = false;
  const start = i;

  while (i < pattern.length && (pattern[i] !== ']' || i === start)) {
    if (i + 2 < pattern.length && pattern[i + 1] === '-' && pattern[i + 2] !== ']') {
      // Range
      if (ch >= pattern[i] && ch <= pattern[i + 2]) {
        matched = true;
      }
      i += 3;
    } else {
      if (ch === pattern[i]) {
        matched = true;
      }
      i++;
    }
  }

  if (i < pattern.length && pattern[i] === ']') {
    i++; // skip ]
  }

  return { matched: negate ? !matched : matched, end: i };
}

/**
 * Expand a glob pattern against the VFS.
 * Returns sorted matching paths, or [pattern] if no matches.
 */
export function expandGlob(pattern: string, cwd: string, vfs: VFS): string[] {
  // If no glob chars, return as-is
  if (!hasGlobChars(pattern)) {
    return [pattern];
  }

  const absPattern = pattern.startsWith('/') ? pattern : resolve(cwd, pattern);
  const parts = absPattern.split('/').filter(Boolean);
  const isAbsolute = pattern.startsWith('/');

  let candidates = ['/'];

  for (const part of parts) {
    const nextCandidates: string[] = [];

    if (!hasGlobChars(part)) {
      // Literal path segment
      for (const dir of candidates) {
        const full = dir === '/' ? `/${part}` : `${dir}/${part}`;
        if (vfs.exists(full)) {
          nextCandidates.push(full);
        }
      }
    } else {
      // Glob segment -- match against directory entries
      for (const dir of candidates) {
        try {
          const entries = vfs.readdir(dir);
          for (const entry of entries) {
            if (globMatch(part, entry.name)) {
              const full = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
              nextCandidates.push(full);
            }
          }
        } catch {
          // dir doesn't exist or isn't a directory
        }
      }
    }

    candidates = nextCandidates;
  }

  if (candidates.length === 0) {
    return [pattern]; // no matches, return literal
  }

  // Convert back to relative paths if pattern was relative
  let results: string[];
  if (isAbsolute) {
    results = candidates;
  } else {
    const prefix = cwd === '/' ? '/' : cwd + '/';
    results = candidates.map((c) => {
      if (c.startsWith(prefix)) {
        return c.slice(prefix.length);
      }
      return c;
    });
  }

  return results.sort();
}

function hasGlobChars(s: string): boolean {
  return s.includes('*') || s.includes('?') || s.includes('[');
}
