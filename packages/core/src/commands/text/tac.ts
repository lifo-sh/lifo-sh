import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let exitCode = 0;

  const processContent = (content: string) => {
    const lines = content.replace(/\n$/, '').split('\n');
    lines.reverse();
    ctx.stdout.write(lines.join('\n') + '\n');
  };

  if (ctx.args.length === 0) {
    if (ctx.stdin) {
      processContent(await ctx.stdin.readAll());
    } else {
      ctx.stderr.write('tac: missing operand\n');
      return 1;
    }
    return 0;
  }

  for (const arg of ctx.args) {
    const path = resolve(ctx.cwd, arg);
    try {
      processContent(ctx.vfs.readFileString(path));
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`tac: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
