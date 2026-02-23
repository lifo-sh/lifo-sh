import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const ms = performance.now();
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  ctx.stdout.write(`up ${parts.join(', ')}\n`);
  return 0;
};

export default command;
