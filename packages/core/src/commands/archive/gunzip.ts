import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { decompressGzip } from '../../utils/archive.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let keep = false;
  const files: string[] = [];

  for (const arg of ctx.args) {
    switch (arg) {
      case '-k': case '--keep': keep = true; break;
      case '--help':
        ctx.stdout.write('Usage: gunzip [-k] file.gz\n');
        ctx.stdout.write('  -k, --keep   keep original file\n');
        return 0;
      default:
        if (arg.startsWith('-')) {
          ctx.stderr.write(`gunzip: unknown option: ${arg}\n`);
          return 1;
        }
        files.push(arg);
    }
  }

  if (files.length === 0) {
    ctx.stderr.write('gunzip: missing file operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      if (!path.endsWith('.gz')) {
        ctx.stderr.write(`gunzip: ${file}: unknown suffix -- ignored\n`);
        exitCode = 1;
        continue;
      }
      const data = ctx.vfs.readFile(path);
      const decompressed = await decompressGzip(data);
      const outPath = path.slice(0, -3);
      ctx.vfs.writeFile(outPath, decompressed);
      if (!keep) ctx.vfs.unlink(path);
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`gunzip: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
