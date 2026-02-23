import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { createZip, collectFiles } from '../../utils/archive.js';
import type { ZipEntry } from '../../utils/archive.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  if (ctx.args.length === 0 || ctx.args[0] === '--help') {
    ctx.stdout.write('Usage: zip archive.zip file1 [file2 ...]\n');
    return ctx.args.length === 0 ? 1 : 0;
  }

  const archiveFile = ctx.args[0];
  const files = ctx.args.slice(1);

  if (files.length === 0) {
    ctx.stderr.write('zip: no files to archive\n');
    return 1;
  }

  const archivePath = resolve(ctx.cwd, archiveFile);

  try {
    const tarEntries = collectFiles(ctx.vfs, ctx.cwd, files);

    const zipEntries: ZipEntry[] = tarEntries.map((e) => ({
      path: e.path,
      data: e.data,
      isDirectory: e.type === 'directory',
    }));

    const data = createZip(zipEntries);
    ctx.vfs.writeFile(archivePath, data);

    for (const entry of zipEntries) {
      const label = entry.isDirectory ? 'adding:' : 'adding:';
      ctx.stdout.write(`  ${label} ${entry.path}${entry.isDirectory ? '/' : ''}\n`);
    }
  } catch (e) {
    if (e instanceof VFSError) {
      ctx.stderr.write(`zip: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  return 0;
};

export default command;
