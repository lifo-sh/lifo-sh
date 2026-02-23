import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const args = ctx.args;

  if (args.length === 0) {
    ctx.stderr.write('seq: missing operand\n');
    return 1;
  }

  let first = 1;
  let increment = 1;
  let last: number;
  let separator = '\n';

  // Parse -s option
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-s' && i + 1 < args.length) {
      separator = args[++i];
    } else if (args[i] === '-w') {
      // -w (equal width) -- we'll handle padding
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length === 1) {
    last = parseFloat(positional[0]);
  } else if (positional.length === 2) {
    first = parseFloat(positional[0]);
    last = parseFloat(positional[1]);
  } else {
    first = parseFloat(positional[0]);
    increment = parseFloat(positional[1]);
    last = parseFloat(positional[2]);
  }

  if (isNaN(first) || isNaN(increment) || isNaN(last)) {
    ctx.stderr.write('seq: invalid argument\n');
    return 1;
  }

  if (increment === 0) {
    ctx.stderr.write('seq: zero increment\n');
    return 1;
  }

  const results: string[] = [];
  const isInt = Number.isInteger(first) && Number.isInteger(increment) && Number.isInteger(last);

  if (increment > 0) {
    for (let n = first; n <= last + 1e-10; n += increment) {
      results.push(isInt ? String(Math.round(n)) : String(n));
    }
  } else {
    for (let n = first; n >= last - 1e-10; n += increment) {
      results.push(isInt ? String(Math.round(n)) : String(n));
    }
  }

  if (results.length > 0) {
    ctx.stdout.write(results.join(separator) + '\n');
  }

  return 0;
};

export default command;
