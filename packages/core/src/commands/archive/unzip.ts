import type { Command } from '../types.js';
import { resolve, dirname } from '../../utils/path.js';
import { parseZip } from '../../utils/archive.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let listOnly = false;
  let destDir = '';
  let archiveFile = '';

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    switch (arg) {
      case '-l': case '--list':
        listOnly = true;
        break;
      case '-d':
        destDir = ctx.args[++i] || '';
        break;
      case '--help':
        ctx.stdout.write('Usage: unzip [-l] [-d dir] archive.zip\n');
        ctx.stdout.write('  -l       list contents\n');
        ctx.stdout.write('  -d dir   extract to directory\n');
        return 0;
      default:
        if (arg.startsWith('-')) {
          ctx.stderr.write(`unzip: unknown option: ${arg}\n`);
          return 1;
        }
        archiveFile = arg;
    }
  }

  if (!archiveFile) {
    ctx.stderr.write('unzip: missing archive operand\n');
    return 1;
  }

  const archivePath = resolve(ctx.cwd, archiveFile);
  const targetDir = destDir ? resolve(ctx.cwd, destDir) : ctx.cwd;

  try {
    const data = ctx.vfs.readFile(archivePath);
    const entries = parseZip(data);

    if (listOnly) {
      ctx.stdout.write('  Length      Name\n');
      ctx.stdout.write('---------  ----\n');
      let totalSize = 0;
      for (const entry of entries) {
        const size = entry.data.length;
        totalSize += size;
        const path = entry.isDirectory ? entry.path + '/' : entry.path;
        ctx.stdout.write(`${String(size).padStart(9)}  ${path}\n`);
      }
      ctx.stdout.write('---------  ----\n');
      ctx.stdout.write(`${String(totalSize).padStart(9)}  ${entries.length} file(s)\n`);
      return 0;
    }

    // Ensure target dir exists
    if (destDir) {
      try { ctx.vfs.mkdir(targetDir, { recursive: true }); } catch { /* exists */ }
    }

    for (const entry of entries) {
      const entryPath = resolve(targetDir, entry.path);

      if (entry.isDirectory) {
        try { ctx.vfs.mkdir(entryPath, { recursive: true }); } catch { /* exists */ }
      } else {
        const parent = dirname(entryPath);
        try { ctx.vfs.mkdir(parent, { recursive: true }); } catch { /* exists */ }
        ctx.vfs.writeFile(entryPath, entry.data);
      }

      ctx.stdout.write(`  extracting: ${entry.path}${entry.isDirectory ? '/' : ''}\n`);
    }
  } catch (e) {
    if (e instanceof VFSError) {
      ctx.stderr.write(`unzip: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  return 0;
};

export default command;
