import type { Command } from '../types.js';
import { parseArgs } from '../../utils/args.js';
import { resolve, dirname } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const spec = {
  parents: { type: 'boolean' as const, short: 'p' },
};

const command: Command = async (ctx) => {
  const { flags, positional } = parseArgs(ctx.args, spec);

  if (positional.length === 0) {
    ctx.stderr.write('rmdir: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const arg of positional) {
    const path = resolve(ctx.cwd, arg);
    try {
      ctx.vfs.rmdir(path);

      if (flags.parents) {
        // Walk up removing empty parent directories
        let parent = dirname(path);
        while (parent !== '/' && parent !== '.') {
          try {
            ctx.vfs.rmdir(parent);
            parent = dirname(parent);
          } catch {
            break;
          }
        }
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`rmdir: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
