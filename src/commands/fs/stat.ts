import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    ctx.stderr.write('stat: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const arg of ctx.args) {
    const path = resolve(ctx.cwd, arg);
    try {
      const st = ctx.vfs.stat(path);
      const mode = '0' + st.mode.toString(8);
      const type = st.type === 'directory' ? 'directory' : 'regular file';
      ctx.stdout.write(`  File: ${arg}\n`);
      ctx.stdout.write(`  Size: ${st.size}\tType: ${type}\n`);
      ctx.stdout.write(`  Mode: ${mode}\n`);
      ctx.stdout.write(`  Created: ${new Date(st.ctime).toISOString()}\n`);
      ctx.stdout.write(`  Modified: ${new Date(st.mtime).toISOString()}\n`);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`stat: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
