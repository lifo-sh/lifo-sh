import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

function extractStrings(data: Uint8Array, minLen: number): string[] {
  const results: string[] = [];
  let current = '';

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    // Printable ASCII range (space through tilde) plus tab
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= minLen) {
        results.push(current);
      }
      current = '';
    }
  }
  if (current.length >= minLen) {
    results.push(current);
  }

  return results;
}

const command: Command = async (ctx) => {
  let minLen = 4;
  const files: string[] = [];

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-n' && i + 1 < ctx.args.length) {
      minLen = parseInt(ctx.args[++i], 10);
      if (isNaN(minLen) || minLen < 1) minLen = 4;
    } else if (arg.startsWith('-') && arg.length > 1 && !isNaN(parseInt(arg.slice(1), 10))) {
      minLen = parseInt(arg.slice(1), 10);
      if (minLen < 1) minLen = 4;
    } else {
      files.push(arg);
    }
  }

  let exitCode = 0;

  if (files.length === 0) {
    ctx.stderr.write('Usage: strings [-n MIN] FILE...\n');
    ctx.stderr.write('Print sequences of printable characters from files.\n');
    return 1;
  }

  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      const data = ctx.vfs.readFile(path);
      for (const s of extractStrings(data, minLen)) {
        ctx.stdout.write(s + '\n');
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`strings: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
