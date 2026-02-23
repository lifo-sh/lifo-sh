import type { Command } from '../types.js';
import { parseArgs } from '../../utils/args.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const spec = {
  recursive: { type: 'boolean' as const, short: 'R' },
};

const command: Command = async (ctx) => {
  const { positional } = parseArgs(ctx.args, spec);

  if (positional.length < 2) {
    ctx.stderr.write('chown: missing operand\n');
    return 1;
  }

  // First positional is OWNER[:GROUP], rest are files
  const files = positional.slice(1);
  let exitCode = 0;

  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      // Verify file exists
      ctx.vfs.stat(path);
      // No-op: single-user system, ownership is always user:user
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`chown: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
