/**
 * Module preloader — fallback for environments without SharedArrayBuffer.
 *
 * Scans transformed CJS code for require(STRING_LITERAL) calls, recursively
 * fetches each referenced file from the VFS, transforms it, and returns a
 * flat map of { resolvedPath → transformedCode } that can be sent to the
 * worker in the 'run' message.
 *
 * Dynamic require(expr) calls (non-literal paths) cannot be discovered
 * statically and will throw at runtime in fallback mode.
 */

import type { VFS } from '../kernel/vfs/index.js';
import { transform } from './transformer.js';

// ── path utilities ────────────────────────────────────────────────────────────

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function normalizePath(raw: string): string {
  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return '/' + parts.join('/');
}

function resolvePath(from: string, spec: string): string {
  if (spec.startsWith('/')) return normalizePath(spec);
  return normalizePath(dirnameOf(from) + '/' + spec);
}

const EXTENSIONS = ['', '.js', '.ts', '.mjs', '.cjs'];

// ── static require() specifier extraction ─────────────────────────────────────

function extractRequireSpecs(code: string): string[] {
  const specs = new Set<string>();
  const re = /(?:\brequire|\b__dynamicImport__)\s*\(\s*(['"`])(.*?)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const spec = m[2];
    if (spec.startsWith('.') || spec.startsWith('/')) specs.add(spec);
  }
  return [...specs];
}

// ── VFS resolution ────────────────────────────────────────────────────────────

function resolveFromVFS(
  spec: string,
  fromPath: string,
  vfs: VFS,
): { resolvedPath: string; rawCode: string } | null {
  const base = resolvePath(fromPath, spec);

  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (vfs.exists(candidate)) return { resolvedPath: candidate, rawCode: vfs.readFileString(candidate) };
  }
  for (const ext of EXTENSIONS) {
    const candidate = base + '/index' + ext;
    if (vfs.exists(candidate)) return { resolvedPath: candidate, rawCode: vfs.readFileString(candidate) };
  }
  return null;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Recursively preload all statically-required modules starting from the
 * already-transformed entry code.
 *
 * @returns A map of { resolvedVFSPath → transformedCJSCode }
 */
export function preloadModules(
  entryTransformedCode: string,
  vfs: VFS,
  entryPath = '/__entry__.js',
): Record<string, string> {
  const preloaded: Record<string, string> = {};
  const visited = new Set<string>();

  function walk(code: string, fromPath: string): void {
    for (const spec of extractRequireSpecs(code)) {
      const resolved = resolveFromVFS(spec, fromPath, vfs);
      if (!resolved || visited.has(resolved.resolvedPath)) continue;

      visited.add(resolved.resolvedPath);
      const transformedCode = transform(resolved.rawCode);
      preloaded[resolved.resolvedPath] = transformedCode;
      walk(transformedCode, resolved.resolvedPath);
    }
  }

  walk(entryTransformedCode, entryPath);
  return preloaded;
}
