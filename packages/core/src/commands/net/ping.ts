import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  let count = 4;
  let host: string | undefined;

  const args = ctx.args;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c') {
      count = parseInt(args[++i] ?? '4', 10);
      if (isNaN(count) || count < 1) count = 4;
    } else if (!arg.startsWith('-')) {
      host = arg;
    }
  }

  if (!host) {
    ctx.stderr.write('ping: missing host\n');
    ctx.stderr.write('Usage: ping [-c count] host\n');
    return 1;
  }

  // Build URL for HEAD request
  let url = host;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  ctx.stdout.write(`PING ${host}: ${count} requests\n`);

  const times: number[] = [];
  let failures = 0;

  for (let i = 0; i < count; i++) {
    if (ctx.signal.aborted) break;

    const start = performance.now();
    try {
      await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: ctx.signal });
      const elapsed = performance.now() - start;
      times.push(elapsed);
      ctx.stdout.write(`Response from ${host}: time=${elapsed.toFixed(1)}ms\n`);
    } catch {
      const elapsed = performance.now() - start;
      if (ctx.signal.aborted) break;
      failures++;
      ctx.stdout.write(`Request to ${host}: timeout (${elapsed.toFixed(1)}ms)\n`);
    }

    // Wait 1s between pings (unless last one)
    if (i < count - 1 && !ctx.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        const onAbort = () => { clearTimeout(timer); resolve(); };
        ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  // Statistics
  const total = times.length + failures;
  const loss = total > 0 ? ((failures / total) * 100).toFixed(0) : '0';

  ctx.stdout.write(`\n--- ${host} ping statistics ---\n`);
  ctx.stdout.write(`${total} packets transmitted, ${times.length} received, ${loss}% packet loss\n`);

  if (times.length > 0) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    ctx.stdout.write(`rtt min/avg/max = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)} ms\n`);
  }

  return failures === total ? 1 : 0;
};

export default command;
