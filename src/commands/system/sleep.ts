import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    ctx.stderr.write('sleep: missing operand\n');
    return 1;
  }

  const seconds = parseFloat(ctx.args[0]);
  if (isNaN(seconds) || seconds < 0) {
    ctx.stderr.write(`sleep: invalid time interval '${ctx.args[0]}'\n`);
    return 1;
  }

  const ms = Math.round(seconds * 1000);

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Allow abort signal to cancel the sleep
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
  });

  return ctx.signal.aborted ? 130 : 0;
};

export default command;
