import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const hostname = ctx.env.HOSTNAME || 'browseros';
  ctx.stdout.write(hostname + '\n');
  return 0;
};

export default command;
