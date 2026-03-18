import type { Command } from '../types.js';
import type { Kernel } from '@lifo-sh/kernel';

export function createLogoutCommand(_kernel: Kernel, deleteToken: () => void, onExit: () => void): Command {
  return async (ctx) => {
    try {
      deleteToken();
      ctx.env.LIFO_TOKEN = '';
      ctx.stdout.write('Logged out.\n');
      onExit();
    } catch {
      ctx.stdout.write('Not logged in.\n');
    }
    return 0;
  };
}

export default createLogoutCommand(null as any, () => {}, () => {});
