import type { Command } from '../types.js';
import { resolve, dirname, join, extname } from '../../utils/path.js';
import { createModuleMap, ProcessExitError } from '../../node-compat/index.js';
import type { NodeContext } from '../../node-compat/index.js';
import { createProcess } from '../../node-compat/process.js';
import { createConsole } from '../../node-compat/console.js';
import { Buffer } from '../../node-compat/buffer.js';
import { VFSError } from '../../kernel/vfs/index.js';
import { ACTIVE_SERVERS } from '../../node-compat/http.js';
import type { VirtualRequestHandler } from '../../kernel/index.js';

const NODE_VERSION = 'v20.0.0';

/** Strip shebang line (e.g. #!/usr/bin/env node) – replace with blank to preserve line numbers */
function stripShebang(src: string): string {
  if (src.charCodeAt(0) === 0x23 /* # */ && src.charCodeAt(1) === 0x21 /* ! */) {
    const nl = src.indexOf('\n');
    if (nl === -1) return '';
    return '\n' + src.slice(nl + 1);
  }
  return src;
}

function createNodeImpl(portRegistry?: Map<number, VirtualRequestHandler>): Command {
  return async (ctx) => {
    // Handle -v/--version
    if (ctx.args.length > 0 && (ctx.args[0] === '-v' || ctx.args[0] === '--version')) {
      ctx.stdout.write(NODE_VERSION + '\n');
      return 0;
    }

    // Handle --help
    if (ctx.args.length > 0 && ctx.args[0] === '--help') {
      ctx.stdout.write('Usage: node [-e code] [script.js] [args...]\n');
      ctx.stdout.write('       node -v\n\n');
      ctx.stdout.write('Options:\n');
      ctx.stdout.write('  -e, --eval <code>   evaluate code\n');
      ctx.stdout.write('  -v, --version       print version\n\n');
      ctx.stdout.write('Limitations:\n');
      ctx.stdout.write('  - CommonJS only (no import/export)\n');
      ctx.stdout.write('  - No event loop (top-level async does not settle)\n');
      ctx.stdout.write('  - No native modules\n');
      ctx.stdout.write('  - require() resolves: built-in modules, relative VFS files, installed packages\n');
      return 0;
    }

    let source: string;
    let filename: string;
    let scriptArgs: string[];

    // Handle -e / --eval
    if (ctx.args.length > 0 && (ctx.args[0] === '-e' || ctx.args[0] === '--eval')) {
      if (ctx.args.length < 2) {
        ctx.stderr.write('node: -e requires an argument\n');
        return 1;
      }
      source = ctx.args[1];
      filename = '[eval]';
      scriptArgs = ctx.args.slice(2);
    } else if (ctx.args.length > 0) {
      // Run script file
      const scriptPath = resolve(ctx.cwd, ctx.args[0]);
      try {
        source = ctx.vfs.readFileString(scriptPath);
      } catch (e) {
        if (e instanceof VFSError) {
          ctx.stderr.write(`node: ${ctx.args[0]}: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
      filename = scriptPath;
      scriptArgs = ctx.args.slice(1);
    } else {
      // No args -- print usage hint
      ctx.stderr.write('Usage: node [-e code] [script.js] [args...]\n');
      return 1;
    }

    const dir = filename === '[eval]' ? ctx.cwd : dirname(filename);

    const nodeCtx: NodeContext = {
      vfs: ctx.vfs,
      cwd: ctx.cwd,
      env: ctx.env,
      stdout: ctx.stdout,
      stderr: ctx.stderr,
      argv: [filename, ...scriptArgs],
      filename,
      dirname: dir,
      signal: ctx.signal,
      portRegistry,
    };

    const moduleMap = createModuleMap(nodeCtx);
    const moduleCache = new Map<string, unknown>();

    // Build require function
    function nodeRequire(name: string): unknown {
      // Check cache
      if (moduleCache.has(name)) return moduleCache.get(name);

      // Built-in modules
      if (moduleMap[name]) {
        const mod = moduleMap[name]();
        moduleCache.set(name, mod);
        return mod;
      }

      // Relative VFS files
      if (name.startsWith('./') || name.startsWith('../') || name.startsWith('/')) {
        const resolved = resolveVfsModule(name, dir);
        if (resolved) {
          const cached = moduleCache.get(resolved.path);
          if (cached) return cached;

          if (resolved.path.endsWith('.json')) {
            const content = ctx.vfs.readFileString(resolved.path);
            const parsed = JSON.parse(content);
            moduleCache.set(resolved.path, parsed);
            return parsed;
          }

          const modSource = ctx.vfs.readFileString(resolved.path);
          return executeModule(modSource, resolved.path, resolved.path);
        }

        throw new Error(`Cannot find module '${name}'`);
      }

      // Node-modules resolution (walk up node_modules, global, legacy)
      const nmResolved = resolveNodeModule(name, dir);
      if (nmResolved) {
        const cached = moduleCache.get(nmResolved.path);
        if (cached) return cached;

        if (nmResolved.path.endsWith('.json')) {
          const content = ctx.vfs.readFileString(nmResolved.path);
          const parsed = JSON.parse(content);
          moduleCache.set(nmResolved.path, parsed);
          return parsed;
        }

        const modSource = ctx.vfs.readFileString(nmResolved.path);
        return executeModule(modSource, nmResolved.path, nmResolved.path);
      }

      throw new Error(`Cannot find module '${name}'`);
    }

    function resolveVfsModule(name: string, fromDir: string): { path: string } | null {
      const absPath = resolve(fromDir, name);

      // Try exact path
      if (ctx.vfs.exists(absPath)) {
        try {
          const stat = ctx.vfs.stat(absPath);
          if (stat.type === 'file') return { path: absPath };
          // Directory -- try index.js
          const indexPath = join(absPath, 'index.js');
          if (ctx.vfs.exists(indexPath)) return { path: indexPath };
        } catch { /* fall through */ }
      }

      // Try .js extension
      if (!extname(absPath) && ctx.vfs.exists(absPath + '.js')) {
        return { path: absPath + '.js' };
      }

      // Try .json extension
      if (!extname(absPath) && ctx.vfs.exists(absPath + '.json')) {
        return { path: absPath + '.json' };
      }

      return null;
    }

    // ── Node-modules resolution (walk up, global, legacy) ──

    function resolveNodeModule(name: string, fromDir: string): { path: string } | null {
      // Parse package name and optional subpath
      let packageName: string;
      let subpath: string | null = null;

      if (name.startsWith('@')) {
        const parts = name.split('/');
        if (parts.length < 2) return null;
        packageName = parts[0] + '/' + parts[1];
        if (parts.length > 2) subpath = parts.slice(2).join('/');
      } else {
        const slashIdx = name.indexOf('/');
        if (slashIdx !== -1) {
          packageName = name.slice(0, slashIdx);
          subpath = name.slice(slashIdx + 1);
        } else {
          packageName = name;
        }
      }

      // Walk up from fromDir
      let current = fromDir;
      for (;;) {
        const candidate = join(current, 'node_modules', packageName);
        if (ctx.vfs.exists(candidate)) {
          const resolved = resolvePackageEntry(candidate, subpath);
          if (resolved) return resolved;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }

      // Global modules
      const globalCandidate = join('/usr/lib/node_modules', packageName);
      if (ctx.vfs.exists(globalCandidate)) {
        const resolved = resolvePackageEntry(globalCandidate, subpath);
        if (resolved) return resolved;
      }

      // Legacy location (pkg command)
      const legacyCandidate = join('/usr/share/pkg/node_modules', packageName);
      if (ctx.vfs.exists(legacyCandidate)) {
        const resolved = resolvePackageEntry(legacyCandidate, subpath);
        if (resolved) return resolved;
      }

      return null;
    }

    function resolvePackageEntry(pkgDir: string, subpath: string | null): { path: string } | null {
      if (subpath) {
        return resolveVfsModule('./' + subpath, pkgDir);
      }

      // Check package.json main field
      const pkgJsonPath = join(pkgDir, 'package.json');
      if (ctx.vfs.exists(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(ctx.vfs.readFileString(pkgJsonPath));
          if (pkgJson.main) {
            const resolved = resolveVfsModule('./' + pkgJson.main, pkgDir);
            if (resolved) return resolved;
          }
        } catch { /* ignore parse errors */ }
      }

      // Default to index.js
      const indexPath = join(pkgDir, 'index.js');
      if (ctx.vfs.exists(indexPath)) return { path: indexPath };

      return null;
    }

    function executeModule(modSource: string, modFilename: string, cacheAs?: string): unknown {
      const modDir = dirname(modFilename);
      const modModule = { exports: {} as Record<string, unknown> };
      const modExports = modModule.exports;

      // Pre-cache to handle circular dependencies (Node.js behaviour)
      if (cacheAs) {
        moduleCache.set(cacheAs, modExports);
      }

      const modNodeCtx: NodeContext = { ...nodeCtx, filename: modFilename, dirname: modDir };
      const modModuleMap = createModuleMap(modNodeCtx);
      const modProcess = createProcess({
        argv: nodeCtx.argv,
        env: nodeCtx.env,
        cwd: nodeCtx.cwd,
        stdout: ctx.stdout,
        stderr: ctx.stderr,
      });
      const modConsole = createConsole(ctx.stdout, ctx.stderr);

      function modRequire(name: string): unknown {
        // Built-in modules from child context
        if (modModuleMap[name]) {
          const cached = moduleCache.get(name);
          if (cached) return cached;
          const mod = modModuleMap[name]();
          moduleCache.set(name, mod);
          return mod;
        }

        if (name.startsWith('./') || name.startsWith('../') || name.startsWith('/')) {
          const resolved = resolveVfsModule(name, modDir);
          if (resolved) {
            const cached = moduleCache.get(resolved.path);
            if (cached) return cached;

            if (resolved.path.endsWith('.json')) {
              const content = ctx.vfs.readFileString(resolved.path);
              const parsed = JSON.parse(content);
              moduleCache.set(resolved.path, parsed);
              return parsed;
            }

            const childSource = ctx.vfs.readFileString(resolved.path);
            return executeModule(childSource, resolved.path, resolved.path);
          }
          throw new Error(`Cannot find module '${name}'`);
        }

        // Node-modules resolution from this module's directory
        const nmResolved = resolveNodeModule(name, modDir);
        if (nmResolved) {
          const cached = moduleCache.get(nmResolved.path);
          if (cached) return cached;

          if (nmResolved.path.endsWith('.json')) {
            const content = ctx.vfs.readFileString(nmResolved.path);
            const parsed = JSON.parse(content);
            moduleCache.set(nmResolved.path, parsed);
            return parsed;
          }

          const childSource = ctx.vfs.readFileString(nmResolved.path);
          return executeModule(childSource, nmResolved.path, nmResolved.path);
        }

        throw new Error(`Cannot find module '${name}'`);
      }

      const cleanSource = stripShebang(modSource);
      const wrapped = `(function(exports, require, module, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, global) {\n${cleanSource}\n})`;

      const fn = new Function('return ' + wrapped)();
      const global = {};
      fn(
        modExports, modRequire, modModule, modFilename, modDir,
        modConsole, modProcess, Buffer,
        globalThis.setTimeout, globalThis.setInterval,
        globalThis.clearTimeout, globalThis.clearInterval,
        global,
      );

      // Update cache if module.exports was reassigned (not just mutated)
      if (cacheAs && modModule.exports !== modExports) {
        moduleCache.set(cacheAs, modModule.exports);
      }

      return modModule.exports;
    }

    // Execute main script
    const process = createProcess({
      argv: nodeCtx.argv,
      env: nodeCtx.env,
      cwd: nodeCtx.cwd,
      stdout: ctx.stdout,
      stderr: ctx.stderr,
    });
    const nodeConsole = createConsole(ctx.stdout, ctx.stderr);

    const module = { exports: {} as Record<string, unknown> };
    const exports = module.exports;
    const global = {};

    const cleanMainSource = stripShebang(source);
    const wrapped = `(function(exports, require, module, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, global) {\n${cleanMainSource}\n})`;

    try {
      const fn = new Function('return ' + wrapped)();
      fn(
        exports, nodeRequire, module, filename, dir,
        nodeConsole, process, Buffer,
        globalThis.setTimeout, globalThis.setInterval,
        globalThis.clearTimeout, globalThis.clearInterval,
        global,
      );

      // Check if any servers were started (long-running process)
      const httpMod = moduleCache.get('http') as { [key: symbol]: unknown[] } | undefined;
      const activeServers = httpMod?.[ACTIVE_SERVERS] as Array<{ getPromise(): Promise<void> | null; close(): void }> | undefined;

      if (activeServers && activeServers.length > 0) {
        // Collect all server promises
        const serverPromises = activeServers
          .map((s) => s.getPromise())
          .filter((p): p is Promise<void> => p !== null);

        if (serverPromises.length > 0) {
          // Wait for all servers to close OR for abort signal
          const abortPromise = new Promise<void>((resolve) => {
            if (ctx.signal.aborted) {
              resolve();
              return;
            }
            ctx.signal.addEventListener('abort', () => resolve(), { once: true });
          });

          await Promise.race([
            Promise.all(serverPromises),
            abortPromise,
          ]);

          // On abort, close all active servers
          if (ctx.signal.aborted) {
            for (const server of [...activeServers]) {
              server.close();
            }
          }
        }
      }

      return 0;
    } catch (e) {
      if (e instanceof ProcessExitError) {
        return e.exitCode;
      }
      if (e instanceof Error) {
        ctx.stderr.write(`${e.stack || e.message}\n`);
      } else {
        ctx.stderr.write(`${String(e)}\n`);
      }
      return 1;
    }
  };
}

export function createNodeCommand(portRegistry: Map<number, VirtualRequestHandler>): Command {
  return createNodeImpl(portRegistry);
}

// Default command (no port registry -- createServer throws)
const command: Command = createNodeImpl();

export default command;
