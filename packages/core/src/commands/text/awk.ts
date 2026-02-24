import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';
import { getMimeType, isBinaryMime } from '../../utils/mime.js';

interface AwkRule {
  pattern: RegExp | 'BEGIN' | 'END' | null;
  action: string;
}

function parseAwkProgram(program: string): AwkRule[] {
  const rules: AwkRule[] = [];
  let remaining = program.trim();

  while (remaining.length > 0) {
    remaining = remaining.trim();
    if (remaining.length === 0) break;

    let pattern: RegExp | 'BEGIN' | 'END' | null = null;
    let action = '';

    if (remaining.startsWith('BEGIN')) {
      pattern = 'BEGIN';
      remaining = remaining.slice(5).trim();
    } else if (remaining.startsWith('END')) {
      pattern = 'END';
      remaining = remaining.slice(3).trim();
    } else if (remaining.startsWith('/')) {
      // /pattern/ { action }
      const endSlash = remaining.indexOf('/', 1);
      if (endSlash > 0) {
        try {
          pattern = new RegExp(remaining.slice(1, endSlash));
        } catch {
          pattern = null;
        }
        remaining = remaining.slice(endSlash + 1).trim();
      }
    }

    if (remaining.startsWith('{')) {
      // Find matching }
      let depth = 0;
      let i = 0;
      for (; i < remaining.length; i++) {
        if (remaining[i] === '{') depth++;
        else if (remaining[i] === '}') { depth--; if (depth === 0) break; }
      }
      action = remaining.slice(1, i).trim();
      remaining = remaining.slice(i + 1).trim();
    } else if (pattern === null) {
      // Bare action without braces -- treat rest as action
      action = remaining;
      remaining = '';
    }

    rules.push({ pattern, action });
  }

  return rules;
}

function executeAction(action: string, fields: string[], line: string, nr: number, nf: number, _fs: string, vars: Map<string, string>): string {
  // Handle print statements
  const output: string[] = [];
  const statements = action.split(';').map((s) => s.trim()).filter(Boolean);

  for (const stmt of statements) {
    if (stmt === 'print' || stmt === 'print $0') {
      output.push(line);
    } else if (stmt.startsWith('print ')) {
      const exprStr = stmt.slice(6).trim();
      const parts = exprStr.split(',').map((p) => p.trim());
      const values = parts.map((p) => evalExpr(p, fields, line, nr, nf, vars));
      output.push(values.join(' '));
    }
  }

  return output.join('\n');
}

function evalExpr(expr: string, fields: string[], line: string, nr: number, nf: number, vars: Map<string, string>): string {
  expr = expr.trim();

  // String literal
  if (expr.startsWith('"') && expr.endsWith('"')) {
    return expr.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  // Field reference
  if (expr.startsWith('$')) {
    const rest = expr.slice(1);
    if (rest === 'NF') {
      return fields[nf - 1] || '';
    }
    const n = parseInt(rest, 10);
    if (n === 0) return line;
    return fields[n - 1] || '';
  }

  // Built-in variables
  if (expr === 'NR') return String(nr);
  if (expr === 'NF') return String(nf);

  // User variable
  if (vars.has(expr)) return vars.get(expr)!;

  return expr;
}

const command: Command = async (ctx) => {
  let fieldSep = /\s+/;
  let fieldSepStr = ' ';
  let program = '';
  const files: string[] = [];

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-F' && i + 1 < ctx.args.length) {
      fieldSepStr = ctx.args[++i];
      fieldSep = new RegExp(fieldSepStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    } else if (arg.startsWith('-F') && arg.length > 2) {
      fieldSepStr = arg.slice(2);
      fieldSep = new RegExp(fieldSepStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    } else if (!program) {
      program = arg;
    } else {
      files.push(arg);
    }
  }

  if (!program) {
    ctx.stderr.write('awk: missing program\n');
    return 1;
  }

  let text = '';
  if (files.length === 0) {
    if (ctx.stdin) {
      text = await ctx.stdin.readAll();
    } else {
      ctx.stderr.write('awk: missing file operand\n');
      return 1;
    }
  } else {
    for (const file of files) {
      const path = resolve(ctx.cwd, file);
      try {
        ctx.vfs.stat(path);
        if (isBinaryMime(getMimeType(path))) {
          ctx.stderr.write(`awk: ${file}: binary file, skipping\n`);
          continue;
        }
        text += ctx.vfs.readFileString(path);
      } catch (e) {
        if (e instanceof VFSError) {
          ctx.stderr.write(`awk: ${file}: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }
  }

  const rules = parseAwkProgram(program);
  const lines = text.replace(/\n$/, '').split('\n');
  const vars = new Map<string, string>();

  // Execute BEGIN blocks
  for (const rule of rules) {
    if (rule.pattern === 'BEGIN') {
      const result = executeAction(rule.action, [], '', 0, 0, fieldSepStr, vars);
      if (result) ctx.stdout.write(result + '\n');
    }
  }

  // Process lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fields = line.split(fieldSep).filter((f) => f !== '');
    const nr = i + 1;
    const nf = fields.length;

    for (const rule of rules) {
      if (rule.pattern === 'BEGIN' || rule.pattern === 'END') continue;

      let matches = true;
      if (rule.pattern instanceof RegExp) {
        matches = rule.pattern.test(line);
      }

      if (matches) {
        const result = executeAction(rule.action, fields, line, nr, nf, fieldSepStr, vars);
        if (result) ctx.stdout.write(result + '\n');
      }
    }
  }

  // Execute END blocks
  for (const rule of rules) {
    if (rule.pattern === 'END') {
      const result = executeAction(rule.action, [], '', lines.length, 0, fieldSepStr, vars);
      if (result) ctx.stdout.write(result + '\n');
    }
  }

  return 0;
};

export default command;
