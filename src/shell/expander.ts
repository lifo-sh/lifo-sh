import type { WordPart } from './types.js';
import type { VFS } from '../kernel/vfs/index.js';
import { expandGlob } from '../utils/glob.js';

export interface ExpandContext {
  env: Record<string, string>;
  lastExitCode: number;
  cwd: string;
  vfs: VFS;
  executeCapture?: (input: string) => Promise<string>;
}

/**
 * Expand all words for a command's arguments.
 * Handles variable expansion, tilde expansion, glob expansion, and command substitution.
 */
export async function expandWords(words: WordPart[][], ctx: ExpandContext): Promise<string[]> {
  const results: string[] = [];

  for (const word of words) {
    const expanded = await expandWordParts(word, ctx);

    // Glob expansion only for unquoted parts
    if (hasUnquotedGlob(word, expanded)) {
      const globResults = expandGlob(expanded, ctx.cwd, ctx.vfs);
      results.push(...globResults);
    } else {
      results.push(expanded);
    }
  }

  return results;
}

/**
 * Expand a single word (e.g., for redirect targets).
 * No glob expansion.
 */
export async function expandWord(parts: WordPart[], ctx: ExpandContext): Promise<string> {
  return expandWordParts(parts, ctx);
}

async function expandWordParts(parts: WordPart[], ctx: ExpandContext): Promise<string> {
  let result = '';

  for (const part of parts) {
    switch (part.quoted) {
      case 'single':
        // Single quotes: literal, no expansion
        result += part.text;
        break;

      case 'double':
        // Double quotes: expand variables and command substitution, no glob
        result += await expandVariablesAndSubst(part.text, ctx);
        break;

      case 'none': {
        // Unquoted: expand tilde, variables, command substitution
        let text = part.text;

        // Tilde expansion at word start
        if (result === '' && text.startsWith('~')) {
          const home = ctx.env['HOME'] ?? '/home/user';
          if (text === '~') {
            text = home;
          } else if (text.startsWith('~/')) {
            text = home + text.slice(1);
          }
        }

        text = await expandVariablesAndSubst(text, ctx);
        result += text;
        break;
      }
    }
  }

  return result;
}

async function expandVariablesAndSubst(text: string, ctx: ExpandContext): Promise<string> {
  let result = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '$') {
      const expanded = await expandDollar(text, i, ctx);
      result += expanded.value;
      i = expanded.end;
    } else {
      result += text[i];
      i++;
    }
  }

  return result;
}

async function expandDollar(
  text: string, pos: number, ctx: ExpandContext,
): Promise<{ value: string; end: number }> {
  const next = text[pos + 1];

  if (next === undefined) {
    return { value: '$', end: pos + 1 };
  }

  // $? -- last exit code
  if (next === '?') {
    return { value: String(ctx.lastExitCode), end: pos + 2 };
  }

  // $(...) -- command substitution
  if (next === '(') {
    let depth = 1;
    let j = pos + 2;
    while (j < text.length && depth > 0) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') depth--;
      j++;
    }
    const cmd = text.slice(pos + 2, j - 1);
    let output = '';
    if (ctx.executeCapture) {
      output = await ctx.executeCapture(cmd);
      // Trim trailing newlines (bash behavior)
      output = output.replace(/\n+$/, '');
    }
    return { value: output, end: j };
  }

  // ${...} -- braced variable
  if (next === '{') {
    let j = pos + 2;
    while (j < text.length && text[j] !== '}') {
      j++;
    }
    const inner = text.slice(pos + 2, j);
    const value = expandBracedVar(inner, ctx);
    return { value, end: j + 1 };
  }

  // $VAR -- simple variable
  if (/[a-zA-Z_]/.test(next)) {
    let j = pos + 1;
    while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) {
      j++;
    }
    const name = text.slice(pos + 1, j);
    return { value: ctx.env[name] ?? '', end: j };
  }

  // Unrecognized $ sequence -- literal
  return { value: '$', end: pos + 1 };
}

function expandBracedVar(inner: string, ctx: ExpandContext): string {
  // ${VAR:-default}
  const defaultMatch = inner.match(/^([a-zA-Z_][a-zA-Z0-9_]*):-(.*)$/);
  if (defaultMatch) {
    const val = ctx.env[defaultMatch[1]];
    return (val !== undefined && val !== '') ? val : defaultMatch[2];
  }

  // ${VAR:+alternative}
  const altMatch = inner.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\+(.*)$/);
  if (altMatch) {
    const val = ctx.env[altMatch[1]];
    return (val !== undefined && val !== '') ? altMatch[2] : '';
  }

  // ${VAR} -- simple
  return ctx.env[inner] ?? '';
}

function hasUnquotedGlob(parts: WordPart[], _expanded: string): boolean {
  // Check if any unquoted part contains glob characters
  for (const part of parts) {
    if (part.quoted === 'none') {
      if (part.text.includes('*') || part.text.includes('?') || part.text.includes('[')) {
        return true;
      }
    }
  }
  return false;
}
