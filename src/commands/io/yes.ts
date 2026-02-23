import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const text = ctx.args.length > 0 ? ctx.args.join(' ') : 'y';

  while (!ctx.signal.aborted) {
    ctx.stdout.write(text + '\n');
    // Yield to event loop to allow abort signal checks
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return 0;
};

export default command;
