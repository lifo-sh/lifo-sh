import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

const command: Command = async (ctx) => {
  let human = false;
  let summaryOnly = false;
  const paths: string[] = [];

  for (const arg of ctx.args) {
    if (arg === '-h') human = true;
    else if (arg === '-s') summaryOnly = true;
    else paths.push(arg);
  }

  if (paths.length === 0) paths.push('.');

  function calcSize(dirPath: string): number {
    let total = 0;
    try {
      const entries = ctx.vfs.readdir(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry.name : dirPath + '/' + entry.name;
        if (entry.type === 'file') {
          const st = ctx.vfs.stat(fullPath);
          total += st.size;
        } else {
          total += calcSize(fullPath);
        }
      }
    } catch {
      // skip inaccessible
    }
    return total;
  }

  function walkAndPrint(dirPath: string, name: string): number {
    let total = 0;
    try {
      const entries = ctx.vfs.readdir(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry.name : dirPath + '/' + entry.name;
        const displayPath = name === '/' ? '/' + entry.name : name + '/' + entry.name;
        if (entry.type === 'file') {
          const st = ctx.vfs.stat(fullPath);
          total += st.size;
        } else {
          const subSize = walkAndPrint(fullPath, displayPath);
          total += subSize;
        }
      }
    } catch {
      // skip
    }
    if (!summaryOnly) {
      const display = human ? humanSize(total) : String(total);
      ctx.stdout.write(display + '\t' + name + '\n');
    }
    return total;
  }

  let exitCode = 0;

  for (const p of paths) {
    const absPath = resolve(ctx.cwd, p);
    try {
      const st = ctx.vfs.stat(absPath);
      if (st.type === 'file') {
        const display = human ? humanSize(st.size) : String(st.size);
        ctx.stdout.write(display + '\t' + p + '\n');
      } else {
        if (summaryOnly) {
          const total = calcSize(absPath);
          const display = human ? humanSize(total) : String(total);
          ctx.stdout.write(display + '\t' + p + '\n');
        } else {
          walkAndPrint(absPath, p);
        }
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`du: ${p}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
