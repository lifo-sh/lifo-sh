import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let count = 10;
  const files: string[] = [];

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-n' && i + 1 < ctx.args.length) {
      count = parseInt(ctx.args[++i], 10);
      if (isNaN(count)) { ctx.stderr.write('tail: invalid number of lines\n'); return 1; }
    } else if (/^-\d+$/.test(arg)) {
      count = parseInt(arg.slice(1), 10);
    } else {
      files.push(arg);
    }
  }

  async function tailText(text: string): Promise<void> {
    const lines = text.replace(/\n$/, '').split('\n');
    const selected = lines.slice(-count);
    ctx.stdout.write(selected.join('\n') + '\n');
  }

  if (files.length === 0) {
    if (ctx.stdin) {
      await tailText(await ctx.stdin.readAll());
    } else {
      ctx.stderr.write('tail: missing file operand\n');
      return 1;
    }
    return 0;
  }

  let exitCode = 0;
  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      const content = ctx.vfs.readFileString(path);
      if (files.length > 1) ctx.stdout.write(`==> ${file} <==\n`);
      await tailText(content);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`tail: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
