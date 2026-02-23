import type { Command } from '../types.js';

function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

const command: Command = async (ctx) => {
  let human = false;

  for (const arg of ctx.args) {
    if (arg === '-h') human = true;
  }

  // Try to use performance.memory (Chrome-only API)
  const perf = performance as unknown as { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number; totalJSHeapSize: number } };
  if (perf.memory) {
    const total = perf.memory.jsHeapSizeLimit;
    const used = perf.memory.usedJSHeapSize;
    const free = total - used;

    if (human) {
      ctx.stdout.write('              total        used        free\n');
      ctx.stdout.write(`Mem:     ${humanSize(total).padStart(10)}  ${humanSize(used).padStart(10)}  ${humanSize(free).padStart(10)}\n`);
    } else {
      ctx.stdout.write('              total        used        free\n');
      ctx.stdout.write(`Mem:     ${String(total).padStart(10)}  ${String(used).padStart(10)}  ${String(free).padStart(10)}\n`);
    }
  } else {
    ctx.stdout.write('Memory information not available in this browser\n');
  }

  return 0;
};

export default command;
