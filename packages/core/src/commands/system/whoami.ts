import type { Command } from '../types.js';

const AUTH_URL = process.env.LIFO_BASE_URL || 'http://localhost:3000';

const command: Command = async (ctx) => {
  const token = ctx.env.LIFO_TOKEN;

  if (!token) {
    ctx.stdout.write((ctx.env.USER || 'user') + '\n');
    return 0;
  }

  try {
    const res = await fetch(`${AUTH_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const { email } = await res.json();
      ctx.stdout.write(email + '\n');
    } else {
      ctx.stdout.write((ctx.env.USER || 'user') + '\n');
    }
  } catch {
    ctx.stdout.write((ctx.env.USER || 'user') + '\n');
  }

  return 0;
};

export default command;
