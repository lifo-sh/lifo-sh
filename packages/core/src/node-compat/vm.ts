// ─── vm module shim ───
// Provides basic script execution via eval/Function in browser environment.
// WARNING: This is inherently less sandboxed than Node's vm module.

export class Script {
  private _code: string;
  private _filename: string;

  constructor(code: string, options?: { filename?: string; lineOffset?: number; columnOffset?: number }) {
    this._code = code;
    this._filename = options?.filename || 'evalmachine.<anonymous>';
  }

  runInThisContext(_options?: Record<string, unknown>): unknown {
    try {
      // Use indirect eval to run in global scope
      return (0, eval)(this._code);
    } catch (e) {
      if (e instanceof Error) {
        e.message = `${this._filename}: ${e.message}`;
      }
      throw e;
    }
  }

  runInNewContext(contextObject?: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
    return runInNewContext(this._code, contextObject, { filename: this._filename });
  }

  createCachedData(): Uint8Array {
    return new Uint8Array(0);
  }
}

export function createScript(code: string, options?: { filename?: string }): Script {
  return new Script(code, options);
}

export function runInThisContext(code: string, _options?: Record<string, unknown>): unknown {
  return (0, eval)(code);
}

export function runInNewContext(code: string, contextObject?: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
  const keys = contextObject ? Object.keys(contextObject) : [];
  const values = contextObject ? Object.values(contextObject) : [];

  // Create a function that destructures context vars and runs the code
  const fn = new Function(...keys, `return (function() { ${code} })()`);
  return fn(...values);
}

export function createContext(contextObject?: Record<string, unknown>): Record<string, unknown> {
  return { ...contextObject };
}

export function isContext(_obj: unknown): boolean {
  return typeof _obj === 'object' && _obj !== null;
}

export function compileFunction(
  code: string,
  params?: string[],
  _options?: Record<string, unknown>,
): (...args: unknown[]) => unknown {
  return new Function(...(params || []), code) as (...args: unknown[]) => unknown;
}

export default {
  Script,
  createScript,
  runInThisContext,
  runInNewContext,
  createContext,
  isContext,
  compileFunction,
};
