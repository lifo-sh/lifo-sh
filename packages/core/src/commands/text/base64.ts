import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function fromBase64(str: string): string {
  try {
    return atob(str.replace(/\s/g, ''));
  } catch {
    throw new Error('invalid input');
  }
}

const command: Command = async (ctx) => {
  let decode = false;
  let wrap = 76;
  const files: string[] = [];

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-d' || arg === '--decode') {
      decode = true;
    } else if (arg === '-w' && i + 1 < ctx.args.length) {
      wrap = parseInt(ctx.args[++i], 10);
    } else if (arg === '--wrap' && i + 1 < ctx.args.length) {
      wrap = parseInt(ctx.args[++i], 10);
    } else if (!arg.startsWith('-') || arg === '-') {
      files.push(arg);
    }
  }

  let input: string | Uint8Array;

  if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
    if (ctx.stdin) {
      input = await ctx.stdin.readAll();
    } else {
      ctx.stderr.write('base64: missing input\n');
      return 1;
    }
  } else {
    const path = resolve(ctx.cwd, files[0]);
    try {
      if (decode) {
        input = ctx.vfs.readFileString(path);
      } else {
        input = ctx.vfs.readFile(path);
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`base64: ${files[0]}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  if (decode) {
    try {
      const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
      ctx.stdout.write(fromBase64(text));
    } catch {
      ctx.stderr.write('base64: invalid input\n');
      return 1;
    }
  } else {
    let data: Uint8Array;
    if (typeof input === 'string') {
      data = new TextEncoder().encode(input);
    } else {
      data = input;
    }
    let encoded = toBase64(data);

    // Wrap lines
    if (wrap > 0) {
      const wrapped: string[] = [];
      for (let i = 0; i < encoded.length; i += wrap) {
        wrapped.push(encoded.slice(i, i + wrap));
      }
      encoded = wrapped.join('\n');
    }

    ctx.stdout.write(encoded + '\n');
  }

  return 0;
};

export default command;
