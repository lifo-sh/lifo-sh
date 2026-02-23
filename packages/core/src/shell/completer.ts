import type { VFS } from '../kernel/vfs/index.js';
import type { CommandRegistry } from '../commands/registry.js';
import { resolve } from '../utils/path.js';

export interface CompletionResult {
  replacementStart: number;
  replacementEnd: number;
  completions: string[];
  commonPrefix: string;
}

export interface CompletionContext {
  line: string;
  cursorPos: number;
  cwd: string;
  env: Record<string, string>;
  vfs: VFS;
  registry: CommandRegistry;
  builtinNames: string[];
}

export function complete(ctx: CompletionContext): CompletionResult {
  const { line, cursorPos } = ctx;
  const beforeCursor = line.slice(0, cursorPos);

  // Find current word being typed
  const { word, start } = findCurrentWord(beforeCursor);

  // Determine completion context
  const context = determineContext(beforeCursor, word);

  let completions: string[];

  switch (context) {
    case 'command':
      completions = completeCommand(word, ctx);
      break;
    case 'directory':
      completions = completeDirectory(word, ctx);
      break;
    case 'variable':
      completions = completeVariable(word.slice(1), ctx); // strip $
      break;
    case 'file':
    default:
      completions = completeFile(word, ctx);
      break;
  }

  const commonPrefix = findCommonPrefix(completions);

  return {
    replacementStart: start,
    replacementEnd: cursorPos,
    completions,
    commonPrefix,
  };
}

function findCurrentWord(beforeCursor: string): { word: string; start: number } {
  let i = beforeCursor.length - 1;

  // Walk back to find word start (skip whitespace-delimited)
  while (i >= 0 && beforeCursor[i] !== ' ' && beforeCursor[i] !== '\t'
    && beforeCursor[i] !== '|' && beforeCursor[i] !== ';'
    && beforeCursor[i] !== '&' && beforeCursor[i] !== '>'
    && beforeCursor[i] !== '<') {
    i--;
  }

  const start = i + 1;
  return { word: beforeCursor.slice(start), start };
}

type CompletionType = 'command' | 'file' | 'directory' | 'variable';

function determineContext(beforeCursor: string, word: string): CompletionType {
  // After $ -> variable
  if (word.startsWith('$')) {
    return 'variable';
  }

  // Find the command context by looking at what's before the word
  const prefix = beforeCursor.slice(0, beforeCursor.length - word.length).trimEnd();

  // After redirect operator -> file
  if (prefix.endsWith('>') || prefix.endsWith('>>') || prefix.endsWith('<')
    || prefix.endsWith('2>') || prefix.endsWith('2>>') || prefix.endsWith('&>')) {
    return 'file';
  }

  // First word or after pipe/connector -> command
  if (prefix === '' || prefix.endsWith('|') || prefix.endsWith('&&')
    || prefix.endsWith('||') || prefix.endsWith(';')) {
    return 'command';
  }

  // After 'cd' -> directory only
  const tokens = prefix.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens[tokens.length - 1] === 'cd') {
    // Wait, we need to check if the first token after the operator is 'cd'
    // Actually let's check if the command is 'cd'
    const lastCmd = getLastCommandName(prefix);
    if (lastCmd === 'cd') {
      return 'directory';
    }
  }

  // Check if after cd more generally
  const lastCmd = getLastCommandName(prefix);
  if (lastCmd === 'cd') {
    return 'directory';
  }

  return 'file';
}

function getLastCommandName(prefix: string): string | null {
  // Split on pipe/connector operators to find the current command
  const parts = prefix.split(/\|{1,2}|&&|;/);
  const lastPart = parts[parts.length - 1].trim();
  const tokens = lastPart.split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens[0] : null;
}

function completeCommand(word: string, ctx: CompletionContext): string[] {
  const all = [...ctx.builtinNames, ...ctx.registry.list()];
  const unique = [...new Set(all)].sort();

  if (!word) return unique;
  return unique.filter((name) => name.startsWith(word));
}

function completeFile(word: string, ctx: CompletionContext): string[] {
  return listEntries(word, ctx, false);
}

function completeDirectory(word: string, ctx: CompletionContext): string[] {
  return listEntries(word, ctx, true);
}

function listEntries(word: string, ctx: CompletionContext, dirsOnly: boolean): string[] {
  // Handle tilde
  let expandedWord = word;
  let tildePrefix = '';
  if (word.startsWith('~/')) {
    const home = ctx.env['HOME'] ?? '/home/user';
    expandedWord = home + word.slice(1);
    tildePrefix = '~/';
  } else if (word === '~') {
    const home = ctx.env['HOME'] ?? '/home/user';
    expandedWord = home;
    tildePrefix = '~';
  }

  let dir: string;
  let prefix: string;

  if (expandedWord.includes('/')) {
    const lastSlash = expandedWord.lastIndexOf('/');
    dir = resolve(ctx.cwd, expandedWord.slice(0, lastSlash + 1));
    prefix = expandedWord.slice(lastSlash + 1);
  } else {
    dir = ctx.cwd;
    prefix = expandedWord;
  }

  try {
    const entries = ctx.vfs.readdir(dir);
    let filtered = entries.filter((e) => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')));

    if (dirsOnly) {
      filtered = filtered.filter((e) => e.type === 'directory');
    }

    return filtered.map((e) => {
      const pathPrefix = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : '';
      const suffix = e.type === 'directory' ? '/' : '';

      // Use tilde prefix if applicable
      if (tildePrefix && pathPrefix.startsWith(tildePrefix)) {
        return pathPrefix + e.name + suffix;
      }

      return pathPrefix + e.name + suffix;
    }).sort();
  } catch {
    return [];
  }
}

function completeVariable(prefix: string, ctx: CompletionContext): string[] {
  return Object.keys(ctx.env)
    .filter((name) => name.startsWith(prefix))
    .map((name) => '$' + name)
    .sort();
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    let j = 0;
    while (j < prefix.length && j < strings[i].length && prefix[j] === strings[i][j]) {
      j++;
    }
    prefix = prefix.slice(0, j);
  }
  return prefix;
}
