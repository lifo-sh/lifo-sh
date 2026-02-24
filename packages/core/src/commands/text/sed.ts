import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';
import { getMimeType, isBinaryMime } from '../../utils/mime.js';

interface SedExpr {
  type: 's' | 'd' | 'p';
  pattern?: RegExp;
  replacement?: string;
  global?: boolean;
}

function parseSedExpr(expr: string): SedExpr | null {
  if (expr === 'd') {
    return { type: 'd' };
  }
  if (expr === 'p') {
    return { type: 'p' };
  }
  // s/pattern/replacement/flags
  if (expr.startsWith('s')) {
    const delim = expr[1];
    if (!delim) return null;
    const parts: string[] = [];
    let current = '';
    let escaped = false;
    for (let i = 2; i < expr.length; i++) {
      if (escaped) {
        current += expr[i];
        escaped = false;
      } else if (expr[i] === '\\') {
        escaped = true;
        current += '\\';
      } else if (expr[i] === delim) {
        parts.push(current);
        current = '';
      } else {
        current += expr[i];
      }
    }
    parts.push(current); // remaining flags part
    if (parts.length < 2) return null;

    const patternStr = parts[0];
    const replacement = parts[1];
    const flagStr = parts[2] || '';
    const globalFlag = flagStr.includes('g');
    const caseInsensitive = flagStr.includes('i');

    let regex: RegExp;
    try {
      let flags = '';
      if (globalFlag) flags += 'g';
      if (caseInsensitive) flags += 'i';
      regex = new RegExp(patternStr, flags);
    } catch {
      return null;
    }

    return { type: 's', pattern: regex, replacement, global: globalFlag };
  }
  return null;
}

const command: Command = async (ctx) => {
  let inPlace = false;
  const expressions: string[] = [];
  const files: string[] = [];

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-i') {
      inPlace = true;
    } else if (arg === '-e' && i + 1 < ctx.args.length) {
      expressions.push(ctx.args[++i]);
    } else if (expressions.length === 0 && !arg.startsWith('-')) {
      expressions.push(arg);
    } else {
      files.push(arg);
    }
  }

  if (expressions.length === 0) {
    ctx.stderr.write('sed: missing expression\n');
    return 1;
  }

  const parsedExprs: SedExpr[] = [];
  for (const expr of expressions) {
    const parsed = parseSedExpr(expr);
    if (!parsed) {
      ctx.stderr.write(`sed: invalid expression: ${expr}\n`);
      return 1;
    }
    parsedExprs.push(parsed);
  }

  function processText(text: string): string {
    const lines = text.replace(/\n$/, '').split('\n');
    const output: string[] = [];

    for (let line of lines) {
      let deleted = false;
      for (const expr of parsedExprs) {
        if (expr.type === 's' && expr.pattern && expr.replacement !== undefined) {
          line = line.replace(expr.pattern, expr.replacement);
        } else if (expr.type === 'd') {
          deleted = true;
          break;
        } else if (expr.type === 'p') {
          output.push(line);
        }
      }
      if (!deleted) {
        output.push(line);
      }
    }

    return output.join('\n') + '\n';
  }

  if (files.length === 0) {
    if (ctx.stdin) {
      const text = await ctx.stdin.readAll();
      ctx.stdout.write(processText(text));
    } else {
      ctx.stderr.write('sed: missing file operand\n');
      return 1;
    }
    return 0;
  }

  let exitCode = 0;
  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      ctx.vfs.stat(path);
      if (isBinaryMime(getMimeType(path))) {
        ctx.stderr.write(`sed: ${file}: binary file, skipping\n`);
        continue;
      }
      const content = ctx.vfs.readFileString(path);
      const result = processText(content);
      if (inPlace) {
        ctx.vfs.writeFile(path, result);
      } else {
        ctx.stdout.write(result);
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`sed: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
