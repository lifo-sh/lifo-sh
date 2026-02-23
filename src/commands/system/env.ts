import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  for (const [key, value] of Object.entries(ctx.env)) {
    ctx.stdout.write(`${key}=${value}\n`);
  }
  return 0;
};

export default command;
