import type { Command } from '../types.js';

const TOKEN_PATH = '/home/user/.lifo-token';
const BASE_URL = process.env.LIFO_BASE_URL || 'http://localhost:3000';
const AUTH_URL = `${BASE_URL}/auth/cli`;

const command: Command = async (ctx) => {
  const sub = ctx.args[0];

  // lifo login --logout
  if (sub === '--logout' || sub === 'logout') {
    try {
      ctx.vfs.unlink(TOKEN_PATH);
      ctx.stdout.write('Logged out.\n');
    } catch {
      ctx.stdout.write('Not logged in.\n');
    }
    return 0;
  }

  // lifo login --status
  if (sub === '--status' || sub === 'status') {
    try {
      const token = ctx.vfs.readFileString(TOKEN_PATH).trim();
      if (token) {
        ctx.stdout.write(`Logged in. API key: ${token.slice(0, 12)}...\n`);
      } else {
        ctx.stdout.write('Not logged in. Run: login\n');
      }
    } catch {
      ctx.stdout.write('Not logged in. Run: login\n');
    }
    return 0;
  }

  // lifo login — full flow
  const link = `\x1b]8;;${AUTH_URL}\x1b\\\x1b[34m${AUTH_URL}\x1b[0m\x1b]8;;\x1b\\`;
  ctx.stdout.write(`Open this URL in your browser:\n\n  ${link}\n\n`);
  ctx.stdout.write('Paste your token: ');

  const token = (await ctx.stdin?.read())?.trim();

  if (!token) {
    ctx.stderr.write('No token provided.\n');
    return 1;
  }

  if (!token.startsWith('lifo_')) {
    ctx.stderr.write('Invalid API key. It should start with lifo_\n');
    return 1;
  }

  ctx.vfs.mkdir('/home/user', { recursive: true });
  ctx.vfs.writeFile(TOKEN_PATH, token);

  ctx.stdout.write(`\nLogged in. API key saved.\n`);

  return 0;
};

export default command;
