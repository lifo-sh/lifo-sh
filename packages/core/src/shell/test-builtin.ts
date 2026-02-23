import type { VFS } from '../kernel/vfs/index.js';
import type { CommandOutputStream } from '../commands/types.js';

/**
 * Implementation of the `test` / `[` shell builtin.
 * Evaluates conditional expressions.
 */
export function evaluateTest(
  args: string[],
  vfs: VFS,
  stderr: CommandOutputStream,
): number {
  // `[` requires closing `]`
  if (args.length > 0 && args[args.length - 1] === ']') {
    args = args.slice(0, -1);
  }

  if (args.length === 0) {
    return 1; // false
  }

  try {
    const result = parseExpr(args, 0, vfs);
    if (result.pos !== args.length) {
      stderr.write('test: too many arguments\n');
      return 2;
    }
    return result.value ? 0 : 1;
  } catch (e) {
    stderr.write(`test: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

interface ExprResult {
  value: boolean;
  pos: number;
}

function parseExpr(args: string[], pos: number, vfs: VFS): ExprResult {
  return parseOr(args, pos, vfs);
}

function parseOr(args: string[], pos: number, vfs: VFS): ExprResult {
  let left = parseAnd(args, pos, vfs);

  while (left.pos < args.length && args[left.pos] === '-o') {
    const right = parseAnd(args, left.pos + 1, vfs);
    left = { value: left.value || right.value, pos: right.pos };
  }

  return left;
}

function parseAnd(args: string[], pos: number, vfs: VFS): ExprResult {
  let left = parsePrimary(args, pos, vfs);

  while (left.pos < args.length && args[left.pos] === '-a') {
    const right = parsePrimary(args, left.pos + 1, vfs);
    left = { value: left.value && right.value, pos: right.pos };
  }

  return left;
}

function parsePrimary(args: string[], pos: number, vfs: VFS): ExprResult {
  if (pos >= args.length) {
    return { value: false, pos };
  }

  const arg = args[pos];

  // Negation
  if (arg === '!') {
    const result = parsePrimary(args, pos + 1, vfs);
    return { value: !result.value, pos: result.pos };
  }

  // Parenthesized expression
  if (arg === '(') {
    const result = parseExpr(args, pos + 1, vfs);
    if (result.pos >= args.length || args[result.pos] !== ')') {
      throw new Error('missing )');
    }
    return { value: result.value, pos: result.pos + 1 };
  }

  // Unary string tests
  if (arg === '-z' && pos + 1 < args.length) {
    return { value: args[pos + 1].length === 0, pos: pos + 2 };
  }
  if (arg === '-n' && pos + 1 < args.length) {
    return { value: args[pos + 1].length > 0, pos: pos + 2 };
  }

  // Unary file tests
  if (arg.startsWith('-') && arg.length === 2 && pos + 1 < args.length) {
    const flag = arg[1];
    const filePath = args[pos + 1];
    const fileResult = evaluateFileTest(flag, filePath, vfs);
    if (fileResult !== null) {
      return { value: fileResult, pos: pos + 2 };
    }
  }

  // Binary operators: check if there's an operator at pos+1
  if (pos + 2 <= args.length) {
    const op = args[pos + 1];
    if (op !== undefined) {
      // String comparisons
      if (op === '=' || op === '==') {
        return { value: args[pos] === args[pos + 2], pos: pos + 3 };
      }
      if (op === '!=') {
        return { value: args[pos] !== args[pos + 2], pos: pos + 3 };
      }
      if (op === '<') {
        return { value: args[pos] < args[pos + 2], pos: pos + 3 };
      }
      if (op === '>') {
        return { value: args[pos] > args[pos + 2], pos: pos + 3 };
      }

      // Integer comparisons
      if (op === '-eq') {
        return { value: toInt(args[pos]) === toInt(args[pos + 2]), pos: pos + 3 };
      }
      if (op === '-ne') {
        return { value: toInt(args[pos]) !== toInt(args[pos + 2]), pos: pos + 3 };
      }
      if (op === '-lt') {
        return { value: toInt(args[pos]) < toInt(args[pos + 2]), pos: pos + 3 };
      }
      if (op === '-le') {
        return { value: toInt(args[pos]) <= toInt(args[pos + 2]), pos: pos + 3 };
      }
      if (op === '-gt') {
        return { value: toInt(args[pos]) > toInt(args[pos + 2]), pos: pos + 3 };
      }
      if (op === '-ge') {
        return { value: toInt(args[pos]) >= toInt(args[pos + 2]), pos: pos + 3 };
      }
    }
  }

  // Single string argument -- true if non-empty
  return { value: arg.length > 0, pos: pos + 1 };
}

function evaluateFileTest(flag: string, path: string, vfs: VFS): boolean | null {
  switch (flag) {
    case 'e': {
      return vfs.exists(path);
    }
    case 'f': {
      if (!vfs.exists(path)) return false;
      try {
        const stat = vfs.stat(path);
        return stat.type === 'file';
      } catch {
        return false;
      }
    }
    case 'd': {
      if (!vfs.exists(path)) return false;
      try {
        const stat = vfs.stat(path);
        return stat.type === 'directory';
      } catch {
        return false;
      }
    }
    case 's': {
      if (!vfs.exists(path)) return false;
      try {
        const stat = vfs.stat(path);
        return stat.type === 'file' && stat.size > 0;
      } catch {
        return false;
      }
    }
    case 'r':
    case 'w':
    case 'x': {
      // In VFS, all files are readable/writable/executable if they exist
      return vfs.exists(path);
    }
    default:
      return null;
  }
}

function toInt(s: string): number {
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}
