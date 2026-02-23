import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { globMatch } from '../../utils/glob.js';
import { VFSError } from '../../kernel/vfs/index.js';

const command: Command = async (ctx) => {
  let searchPath = '.';
  let namePattern = '';
  let typeFilter = ''; // 'f' or 'd'
  let maxDepth = Infinity;

  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === '-name' && i + 1 < ctx.args.length) {
      namePattern = ctx.args[++i];
    } else if (arg === '-type' && i + 1 < ctx.args.length) {
      typeFilter = ctx.args[++i];
    } else if (arg === '-maxdepth' && i + 1 < ctx.args.length) {
      maxDepth = parseInt(ctx.args[++i], 10);
    } else if (!arg.startsWith('-')) {
      searchPath = arg;
    }
  }

  const absPath = resolve(ctx.cwd, searchPath);

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = ctx.vfs.readdir(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry.name : dirPath + '/' + entry.name;

        let matches = true;
        if (namePattern) {
          matches = globMatch(namePattern, entry.name);
        }
        if (typeFilter) {
          if (typeFilter === 'f' && entry.type !== 'file') matches = false;
          if (typeFilter === 'd' && entry.type !== 'directory') matches = false;
        }

        if (matches) {
          ctx.stdout.write(fullPath + '\n');
        }

        if (entry.type === 'directory') {
          walk(fullPath, depth + 1);
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  try {
    const stat = ctx.vfs.stat(absPath);
    if (stat.type !== 'directory') {
      // If it's a file, just check if it matches
      ctx.stdout.write(absPath + '\n');
      return 0;
    }
  } catch (e) {
    if (e instanceof VFSError) {
      ctx.stderr.write(`find: '${searchPath}': ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  walk(absPath, 1);
  return 0;
};

export default command;
