import type { Command } from '../types.js';
import { resolve, dirname, join, extname } from '../../utils/path.js';
import { createModuleMap, ProcessExitError } from '../../node-compat/index.js';
import type { NodeContext } from '../../node-compat/index.js';
import { createProcess } from '../../node-compat/process.js';
import { createConsole } from '../../node-compat/console.js';
import { Buffer } from '../../node-compat/buffer.js';
import { VFSError } from '../../kernel/vfs/index.js';

const NODE_VERSION = 'v20.0.0';

const command: Command = async (ctx) => {
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
        const modExports = executeModule(modSource, resolved.path);
        moduleCache.set(resolved.path, modExports);
        return modExports;
      }

      throw new Error(`Cannot find module '${name}'`);
    }

    // Installed packages: /usr/share/pkg/node_modules/<name>/index.js
    const pkgPath = `/usr/share/pkg/node_modules/${name}/index.js`;
    if (ctx.vfs.exists(pkgPath)) {
      const cached = moduleCache.get(pkgPath);
      if (cached) return cached;

      const modSource = ctx.vfs.readFileString(pkgPath);
      const modExports = executeModule(modSource, pkgPath);
      moduleCache.set(pkgPath, modExports);
      return modExports;
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

  function executeModule(modSource: string, modFilename: string): unknown {
    const modDir = dirname(modFilename);
    const modModule = { exports: {} as Record<string, unknown> };
    const modExports = modModule.exports;

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
          const childExports = executeModule(childSource, resolved.path);
          moduleCache.set(resolved.path, childExports);
          return childExports;
        }
        throw new Error(`Cannot find module '${name}'`);
      }

      return nodeRequire(name);
    }

    const wrapped = `(function(exports, require, module, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, global) {\n${modSource}\n})`;

    const fn = new Function('return ' + wrapped)();
    const global = {};
    fn(
      modExports, modRequire, modModule, modFilename, modDir,
      modConsole, modProcess, Buffer,
      globalThis.setTimeout, globalThis.setInterval,
      globalThis.clearTimeout, globalThis.clearInterval,
      global,
    );

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

  const wrapped = `(function(exports, require, module, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, global) {\n${source}\n})`;

  try {
    const fn = new Function('return ' + wrapped)();
    fn(
      exports, nodeRequire, module, filename, dir,
      nodeConsole, process, Buffer,
      globalThis.setTimeout, globalThis.setInterval,
      globalThis.clearTimeout, globalThis.clearInterval,
      global,
    );
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

export default command;
