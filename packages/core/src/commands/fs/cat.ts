import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    // Read from stdin if available (enables piping: echo hi | cat)
    if (ctx.stdin) {
      const content = await ctx.stdin.readAll();
      ctx.stdout.write(content);
      return 0;
    }
    ctx.stderr.write('cat: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const arg of ctx.args) {
    const path = resolve(ctx.cwd, arg);
    try {
      const content = ctx.vfs.readFileString(path);
      ctx.stdout.write(content);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`cat: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
