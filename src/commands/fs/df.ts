import type { Command } from '../types.js';

function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

const command: Command = async (ctx) => {
  let human = false;

  for (const arg of ctx.args) {
    if (arg === '-h') human = true;
  }

  // Walk the entire VFS to count files and bytes
  let totalFiles = 0;
  let totalBytes = 0;

  function walk(dirPath: string): void {
    try {
      const entries = ctx.vfs.readdir(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry.name : dirPath + '/' + entry.name;
        if (entry.type === 'file') {
          totalFiles++;
          const st = ctx.vfs.stat(fullPath);
          totalBytes += st.size;
        } else {
          walk(fullPath);
        }
      }
    } catch {
      // skip
    }
  }

  walk('/');

  const totalSpace = 256 * 1024 * 1024; // 256MB virtual space
  const used = totalBytes;
  const avail = totalSpace - used;

  if (human) {
    ctx.stdout.write('Filesystem      Size  Used  Avail  Use%  Mounted on\n');
    ctx.stdout.write(`vfs             ${humanSize(totalSpace)}  ${humanSize(used)}  ${humanSize(avail)}  ${Math.round((used / totalSpace) * 100)}%    /\n`);
  } else {
    ctx.stdout.write('Filesystem      1K-blocks    Used    Available  Use%  Mounted on\n');
    ctx.stdout.write(`vfs             ${Math.round(totalSpace / 1024)}    ${Math.round(used / 1024)}    ${Math.round(avail / 1024)}  ${Math.round((used / totalSpace) * 100)}%    /\n`);
  }

  return 0;
};

export default command;
