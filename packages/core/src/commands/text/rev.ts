import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

function reverseLines(text: string): string {
  return text.split('\n').map(line => [...line].reverse().join('')).join('\n');
}

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    if (ctx.stdin) {
      const content = await ctx.stdin.readAll();
      ctx.stdout.write(reverseLines(content));
      return 0;
    }
    ctx.stderr.write('rev: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const arg of ctx.args) {
    const path = resolve(ctx.cwd, arg);
    try {
      const content = ctx.vfs.readFileString(path);
      ctx.stdout.write(reverseLines(content));
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`rev: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
