import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const user = ctx.env.USER || 'unknown';
  ctx.stdout.write(user + '\n');
  return 0;
};

export default command;
