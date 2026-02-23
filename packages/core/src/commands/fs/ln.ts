import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  let symlink = false;

  for (const arg of ctx.args) {
    if (arg === '-s') symlink = true;
  }

  if (symlink) {
    ctx.stderr.write('ln: symbolic links are not supported in Lifo VFS\n');
  } else {
    ctx.stderr.write('ln: hard links are not supported in Lifo VFS\n');
  }

  return 1;
};

export default command;
