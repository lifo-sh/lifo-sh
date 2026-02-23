import type { Command } from '../types.js';

const command: Command = async (ctx) => {
  const info = {
    sysname: 'BrowserOS',
    release: '1.0.0',
    machine: 'wasm',
  };

  if (ctx.args.length === 0) {
    ctx.stdout.write(info.sysname + '\n');
    return 0;
  }

  let showAll = false;
  let showSysname = false;
  let showRelease = false;
  let showMachine = false;

  for (const arg of ctx.args) {
    if (arg.startsWith('-')) {
      for (let i = 1; i < arg.length; i++) {
        switch (arg[i]) {
          case 'a': showAll = true; break;
          case 's': showSysname = true; break;
          case 'r': showRelease = true; break;
          case 'm': showMachine = true; break;
        }
      }
    }
  }

  if (showAll) {
    ctx.stdout.write(`${info.sysname} ${info.release} ${info.machine}\n`);
    return 0;
  }

  const parts: string[] = [];
  if (showSysname) parts.push(info.sysname);
  if (showRelease) parts.push(info.release);
  if (showMachine) parts.push(info.machine);

  if (parts.length === 0) parts.push(info.sysname);
  ctx.stdout.write(parts.join(' ') + '\n');

  return 0;
};

export default command;
