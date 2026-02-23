import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  let maxArgs = 0; // 0 = all at once
  let cmdName = 'echo';
  const cmdArgs: string[] = [];

  let i = 0;
  while (i < ctx.args.length) {
    const arg = ctx.args[i];
    if (arg === '-n' && i + 1 < ctx.args.length) {
      maxArgs = parseInt(ctx.args[++i], 10);
    } else {
      cmdName = arg;
      i++;
      while (i < ctx.args.length) {
        cmdArgs.push(ctx.args[i++]);
      }
      break;
    }
    i++;
  }

  let input = '';
  if (ctx.stdin) {
    input = await ctx.stdin.readAll();
  }

  const inputArgs = input.trim().split(/\s+/).filter(Boolean);
  if (inputArgs.length === 0) return 0;

  // We can't directly invoke commands from here without the registry/interpreter.
  // xargs in our shell will just output the constructed command lines.
  // This is a simplified version that builds and outputs the command + args.
  if (maxArgs > 0) {
    for (let j = 0; j < inputArgs.length; j += maxArgs) {
      const batch = inputArgs.slice(j, j + maxArgs);
      const line = [cmdName, ...cmdArgs, ...batch].join(' ');
      ctx.stdout.write(line + '\n');
    }
  } else {
    const line = [cmdName, ...cmdArgs, ...inputArgs].join(' ');
    ctx.stdout.write(line + '\n');
  }

  return 0;
};

export default command;
