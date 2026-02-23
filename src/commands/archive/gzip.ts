import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { compressGzip, decompressGzip } from '../../utils/archive.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let keep = false;
  let decompress = false;
  const files: string[] = [];

  for (const arg of ctx.args) {
    switch (arg) {
      case '-k': case '--keep': keep = true; break;
      case '-d': case '--decompress': decompress = true; break;
      case '--help':
        ctx.stdout.write('Usage: gzip [-k] [-d] file\n');
        ctx.stdout.write('  -k, --keep         keep original file\n');
        ctx.stdout.write('  -d, --decompress   decompress\n');
        return 0;
      default:
        if (arg.startsWith('-')) {
          ctx.stderr.write(`gzip: unknown option: ${arg}\n`);
          return 1;
        }
        files.push(arg);
    }
  }

  if (files.length === 0) {
    ctx.stderr.write('gzip: missing file operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const file of files) {
    const path = resolve(ctx.cwd, file);
    try {
      if (decompress) {
        if (!path.endsWith('.gz')) {
          ctx.stderr.write(`gzip: ${file}: unknown suffix -- ignored\n`);
          exitCode = 1;
          continue;
        }
        const data = ctx.vfs.readFile(path);
        const decompressed = await decompressGzip(data);
        const outPath = path.slice(0, -3);
        ctx.vfs.writeFile(outPath, decompressed);
        if (!keep) ctx.vfs.unlink(path);
      } else {
        const data = ctx.vfs.readFile(path);
        const compressed = await compressGzip(data);
        ctx.vfs.writeFile(path + '.gz', compressed);
        if (!keep) ctx.vfs.unlink(path);
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`gzip: ${file}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
