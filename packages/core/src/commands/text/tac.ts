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
    ctx.stderr.write('Usage: tac FILE...\n');
    ctx.stderr.write('Print files in reverse line order.\n');
    return 1;
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
