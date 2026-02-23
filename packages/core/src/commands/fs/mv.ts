import type { Command } from '../types.js';
import { resolve, basename } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  if (ctx.args.length < 2) {
    ctx.stderr.write('mv: missing operand\n');
    return 1;
  }

  const src = resolve(ctx.cwd, ctx.args[0]);
  let dest = resolve(ctx.cwd, ctx.args[1]);

  try {
    // If dest is a directory, move into it
    if (ctx.vfs.exists(dest)) {
      const stat = ctx.vfs.stat(dest);
      if (stat.type === 'directory') {
        dest = resolve(dest, basename(src));
      }
    }
    ctx.vfs.rename(src, dest);
    return 0;
  } catch (e) {
    if (e instanceof VFSError) {
      ctx.stderr.write(`mv: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
};

export default command;
