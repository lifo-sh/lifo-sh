import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

const command: Command = async (ctx) => {
  let exitCode = 0;
  let check = false;
  const files: string[] = [];

  for (const arg of ctx.args) {
    if (arg === '-c' || arg === '--check') {
      check = true;
    } else {
      files.push(arg);
    }
  }

  if (check && files.length > 0) {
    // Verify checksums from a file
    const path = resolve(ctx.cwd, files[0]);
    let content: string;
    try {
      content = ctx.vfs.readFileString(path);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`sha256sum: ${files[0]}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }

    for (const line of content.trim().split('\n')) {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
      if (!match) continue;
      const [, expectedHash, fileName] = match;
      const filePath = resolve(ctx.cwd, fileName);
      try {
        const data = ctx.vfs.readFile(filePath);
        const actual = await sha256(data);
        if (actual === expectedHash) {
          ctx.stdout.write(`${fileName}: OK\n`);
        } else {
          ctx.stdout.write(`${fileName}: FAILED\n`);
          exitCode = 1;
        }
      } catch {
        ctx.stdout.write(`${fileName}: FAILED open or read\n`);
        exitCode = 1;
      }
    }
    return exitCode;
  }

  if (files.length === 0) {
    if (ctx.stdin) {
      const text = await ctx.stdin.readAll();
      const data = new TextEncoder().encode(text);
      const hash = await sha256(data);
      ctx.stdout.write(`${hash}  -\n`);
    } else {
      ctx.stderr.write('sha256sum: missing file operand\n');
      return 1;
    }
    return 0;
  }

  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      const data = ctx.vfs.readFile(path);
      const hash = await sha256(data);
      ctx.stdout.write(`${hash}  ${file}\n`);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`sha256sum: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
