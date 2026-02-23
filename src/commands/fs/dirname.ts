import type { Command } from '../types.js';
import { dirname as pathDirname } from '../../utils/path.js';

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    ctx.stderr.write('dirname: missing operand\n');
    return 1;
  }

  for (const arg of ctx.args) {
    ctx.stdout.write(pathDirname(arg) + '\n');
  }
  return 0;
};

export default command;
