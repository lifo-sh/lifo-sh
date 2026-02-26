// ─── module shim ───
// Provides minimal node:module compatibility for browser environment.

export function createRequire(_filename: string | URL): (id: string) => unknown {
  // Return a require function that throws for unknown modules.
  // In browser, we can't load Node modules via require().
  return function require(id: string): unknown {
    throw new Error(
      `Cannot require("${id}") in Lifo browser environment. ` +
      `Use ESM imports or Lifo's package system instead.`
    );
  };
}

export function builtinModules(): string[] {
  return [
    'assert', 'buffer', 'child_process', 'console', 'crypto',
    'dns', 'events', 'fs', 'http', 'https', 'module', 'net',
    'os', 'path', 'process', 'querystring', 'readline', 'stream',
    'string_decoder', 'timers', 'tls', 'url', 'util', 'vm',
    'worker_threads', 'zlib',
  ];
}

export function isBuiltin(moduleName: string): boolean {
  const name = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return builtinModules().includes(name);
}

// Stubs for Module class
export class Module {
  id: string;
  filename: string;
  loaded = false;
  exports: unknown = {};
  parent: Module | null = null;
  children: Module[] = [];
  paths: string[] = [];

  constructor(id: string, parent?: Module) {
    this.id = id;
    this.filename = id;
    this.parent = parent || null;
  }

  require(_id: string): unknown {
    return createRequire(this.filename)(_id);
  }

  static createRequire = createRequire;
  static builtinModules = builtinModules();
  static isBuiltin = isBuiltin;
}

export default {
  createRequire,
  builtinModules: builtinModules(),
  isBuiltin,
  Module,
};
