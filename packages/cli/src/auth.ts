import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export const TOKEN_PATH = path.join(os.homedir(), '.lifo-token');
export const BASE_URL = process.env.LIFO_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://lifo.sh');
export const AUTH_URL = `${BASE_URL}/auth/keys`;

export function readToken(): string | null {
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

export async function handleLogin(): Promise<void> {
  const existing = readToken();
  if (existing) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`, {
        headers: { authorization: `Bearer ${existing}` },
      });
      if (res.ok) {
        const { email } = await res.json();
        process.stdout.write(`Already logged in as ${email}. Login again? (y/N): `);
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const answer: string = await new Promise(resolve => {
          rl2.once('line', line => { rl2.close(); resolve(line.trim().toLowerCase()); });
        });
        if (answer !== 'y') {
          console.log('Aborted.');
          process.exit(0);
        }
      }
    } catch {
      // auth server unreachable, proceed to login
    }
  }

  const link = `\x1b]8;;${AUTH_URL}\x1b\\\x1b[34m${AUTH_URL}\x1b[0m\x1b]8;;\x1b\\`;
  process.stdout.write(`Open this URL in your browser:\n\n  ${link}\n\nPaste your API key: `);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const token: string = await new Promise(resolve => {
    rl.once('line', line => {
      rl.close();
      resolve(line.trim());
    });
  });

  if (!token) {
    console.error('No token provided.');
    process.exit(1);
  }

  if (!token.startsWith('lifo_')) {
    console.error('Invalid API key. It should start with lifo_');
    process.exit(1);
  }

  process.stdout.write('Verifying API key...');
  try {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('\nInvalid API key. Please try again.');
      process.exit(1);
    }
    const { email } = await res.json();
    fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    console.log(` done\nLogged in as ${email}. API key saved to ~/.lifo-token\n`);
  } catch {
    console.error('\nCould not reach auth server. Check your connection.');
    process.exit(1);
  }
}

export function handleLogout(): void {
  try {
    fs.unlinkSync(TOKEN_PATH);
    console.log('Logged out.');
  } catch {
    console.log('Not logged in.');
  }
  process.exit(0);
}

export async function handleWhoami(): Promise<void> {
  const token = readToken();
  if (!token) {
    console.log('not logged in');
    process.exit(0);
  }

  try {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.log('not logged in');
      process.exit(1);
    }
    const { email } = await res.json();
    console.log(email);
  } catch {
    console.log('Could not reach auth server. Check your connection.');
    process.exit(1);
  }
  process.exit(0);
}
