/**
 * Worker-side require() runtime — browser version.
 *
 * Implements synchronous module loading inside a Web Worker using the
 * SharedArrayBuffer + Atomics protocol:
 *
 *   1. Post the file path to the main-thread loader via MessagePort.
 *   2. Block the worker thread with Atomics.wait() until the loader
 *      writes the file content into the shared buffer.
 *   3. Decode the content and evaluate it as a CJS module.
 *   4. Cache exports by resolved path (handles circular deps).
 *
 * Dynamic require(expr) works because path resolution is deferred to
 * runtime — no static analysis needed.
 *
 * SAB layout (must match sync-loader.ts)
 * ──────────────────────────────────────
 * Int32[0]  status   0 = idle | 1 = response ready
 * Int32[1]  length   byte count of content (-1 not found, -2 too large)
 * Uint8[8…] content  UTF-8 file bytes
 */

import { transform } from './transformer.js';

const STATUS_IDLE  = 0;
const HEADER_BYTES = 8;
const LOAD_TIMEOUT = 10_000; // ms — how long to wait for the loader

type Sandbox = Record<string, unknown>;

interface CachedModule {
  exports: Record<string, unknown>;
}

export interface RequireFn {
  (spec: string): unknown;
  cache: Map<string, CachedModule>;
}

export type DynamicImportFn = (spec: string) => Promise<unknown>;

export interface RequireRuntime {
  require: RequireFn;
  /** Returns a dynamic-import function bound to a specific module path. */
  makeDynamicImport: (fromPath: string) => DynamicImportFn;
}

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

// ── runtime factory ───────────────────────────────────────────────────────────

export function createRequireRuntime(
  port: MessagePort,
  sab: SharedArrayBuffer,
  sandbox: Sandbox,
  entryPath = '/__entry__.js',
): RequireRuntime {
  const int32   = new Int32Array(sab);
  const uint8   = new Uint8Array(sab);
  const decoder = new TextDecoder();
  const cache   = new Map<string, CachedModule>();

  // ── sync file fetch via SAB/Atomics ─────────────────────────────────────

  function fetchSync(absPath: string): string | null {
    // Reset status to idle before each request so Atomics.wait blocks correctly
    Atomics.store(int32, 0, STATUS_IDLE);

    // Ask the main-thread loader for this path
    port.postMessage({ path: absPath });

    // Block until the loader signals STATUS_READY
    const result = Atomics.wait(int32, 0, STATUS_IDLE, LOAD_TIMEOUT);
    if (result === 'timed-out')
      throw new Error(`[require] Timed out waiting for: ${absPath}`);

    const length = Atomics.load(int32, 1);
    if (length === -1) return null;                          // not found
    if (length === -2) throw new Error(`[require] File too large for shared buffer: ${absPath}`);

    return decoder.decode(uint8.slice(HEADER_BYTES, HEADER_BYTES + length));
  }

  // ── module resolution (tries extensions + index files) ──────────────────

  function resolveModule(
    spec: string,
    fromPath: string,
  ): { resolvedPath: string; code: string } | null {
    const base = resolvePath(fromPath, spec);

    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      const raw = fetchSync(candidate);
      if (raw !== null) return { resolvedPath: candidate, code: transform(raw) };
    }
    for (const ext of EXTENSIONS) {
      const candidate = base + '/index' + ext;
      const raw = fetchSync(candidate);
      if (raw !== null) return { resolvedPath: candidate, code: transform(raw) };
    }
    return null;
  }

  // ── module evaluation ────────────────────────────────────────────────────

  function loadModule(spec: string, fromPath: string): unknown {
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      throw new Error(
        `[require] Bare module specifier "${spec}" is not supported.\n` +
        `Use a relative path (./foo) or absolute VFS path (/foo).`,
      );
    }

    const resolved = resolveModule(spec, fromPath);
    if (!resolved) {
      throw new Error(`[require] Cannot find module "${spec}" from "${fromPath}"`);
    }

    const { resolvedPath, code } = resolved;

    // Return cached exports — also breaks circular dependency cycles
    if (cache.has(resolvedPath)) return cache.get(resolvedPath)!.exports;

    const mod: CachedModule = { exports: {} };
    cache.set(resolvedPath, mod); // register before eval to handle cycles

    const childRequire = makeRequire(resolvedPath);

    // Evaluate module in a CJS context with sandbox globals injected via `with`.
    // __dynamicImport__ is passed as a parameter (not in sandbox) so the `with`
    // block falls through to the parameter scope, giving each module its own
    // path-correct dynamic importer.
    const factory = new Function(
      'module', 'exports', 'require', '__dirname', '__filename', '__sandbox__', '__dynamicImport__',
      `with (__sandbox__) {\n${code}\n}`,
    );
    factory(mod, mod.exports, childRequire, dirnameOf(resolvedPath), resolvedPath, sandbox, makeDynamicImport(resolvedPath));

    return mod.exports;
  }

  function makeRequire(fromPath: string): RequireFn {
    const fn = (spec: string): unknown => loadModule(spec, fromPath);
    fn.cache = cache;
    return fn as RequireFn;
  }

  function makeDynamicImport(fromPath: string): DynamicImportFn {
    return (spec: string): Promise<unknown> => {
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        return Promise.reject(new Error(
          `[import()] Bare module specifier "${spec}" is not supported.\n` +
          `Use a relative path (./foo) or absolute VFS path (/foo).`,
        ));
      }
      return Promise.resolve(loadModule(spec, fromPath));
    };
  }

  return { require: makeRequire(entryPath), makeDynamicImport };
}

// ── Fallback runtime (no SharedArrayBuffer) ───────────────────────────────────

/**
 * Creates a require() runtime backed by a pre-loaded module map instead of
 * the Atomics protocol. Used when SharedArrayBuffer is not available.
 *
 * `preloaded` is a map of { resolvedVFSPath → already-transformed CJS code }
 * built by module-preloader.ts on the main thread before the run message.
 *
 * Dynamic require(expr) with a runtime expression will throw — only
 * statically-discoverable string-literal require() calls are supported.
 */
export function createFallbackRequireRuntime(
  preloaded: Record<string, string>,
  sandbox: Sandbox,
  entryPath = '/__entry__.js',
): RequireRuntime {
  const cache = new Map<string, CachedModule>();

  function resolveModule(
    spec: string,
    fromPath: string,
  ): { resolvedPath: string; code: string } | null {
    const base = resolvePath(fromPath, spec);

    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (candidate in preloaded) return { resolvedPath: candidate, code: preloaded[candidate] };
    }
    for (const ext of EXTENSIONS) {
      const candidate = base + '/index' + ext;
      if (candidate in preloaded) return { resolvedPath: candidate, code: preloaded[candidate] };
    }
    return null;
  }

  function loadModule(spec: string, fromPath: string): unknown {
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      throw new Error(
        `[require] Bare module specifier "${spec}" is not supported.\n` +
        `Use a relative path (./foo) or absolute VFS path (/foo).`,
      );
    }

    const resolved = resolveModule(spec, fromPath);
    if (!resolved) {
      throw new Error(
        `[require] Cannot find module "${spec}" from "${fromPath}".\n` +
        `Dynamic require() with runtime expressions requires Cross-Origin Isolation (COOP/COEP headers).`,
      );
    }

    const { resolvedPath, code } = resolved;

    if (cache.has(resolvedPath)) return cache.get(resolvedPath)!.exports;

    const mod: CachedModule = { exports: {} };
    cache.set(resolvedPath, mod);

    const childRequire = makeFallbackRequire(resolvedPath);

    const factory = new Function(
      'module', 'exports', 'require', '__dirname', '__filename', '__sandbox__', '__dynamicImport__',
      `with (__sandbox__) {\n${code}\n}`,
    );
    factory(mod, mod.exports, childRequire, dirnameOf(resolvedPath), resolvedPath, sandbox, makeDynamicImport(resolvedPath));

    return mod.exports;
  }

  function makeFallbackRequire(fromPath: string): RequireFn {
    const fn = (spec: string): unknown => loadModule(spec, fromPath);
    fn.cache = cache;
    return fn as RequireFn;
  }

  function makeDynamicImport(fromPath: string): DynamicImportFn {
    return (spec: string): Promise<unknown> => {
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        return Promise.reject(new Error(
          `[import()] Bare module specifier "${spec}" is not supported.\n` +
          `Use a relative path (./foo) or absolute VFS path (/foo).`,
        ));
      }
      return Promise.resolve(loadModule(spec, fromPath));
    };
  }

  return { require: makeFallbackRequire(entryPath), makeDynamicImport };
}
