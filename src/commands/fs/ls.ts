import type { Command } from '../types.js';
import { parseArgs } from '../../utils/args.js';
import { resolve } from '../../utils/path.js';
import { BOLD, BLUE, RESET } from '../../utils/colors.js';
import { VFSError } from '../../kernel/vfs/index.js';

const spec = {
  long: { type: 'boolean' as const, short: 'l' },
  all: { type: 'boolean' as const, short: 'a' },
  one: { type: 'boolean' as const, short: '1' },
};

function formatMode(mode: number, isDir: boolean): string {
  const d = isDir ? 'd' : '-';
  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ].join('');
  return d + perms;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hour}:${min}`;
}

interface LsEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  mode: number;
}

function formatEntry(entry: LsEntry, long: boolean): string {
  const displayName = entry.type === 'directory'
    ? `${BOLD}${BLUE}${entry.name}${RESET}`
    : entry.name;

  if (long) {
    const mode = formatMode(entry.mode, entry.type === 'directory');
    const size = String(entry.size).padStart(6, ' ');
    const date = formatDate(entry.mtime);
    return `${mode}  1 user user ${size} ${date} ${displayName}\n`;
  }
  return displayName;
}

function listDirectory(
  path: string, flags: Record<string, string | boolean>, ctx: import('../types.js').CommandContext,
): LsEntry[] {
  const entries = ctx.vfs.readdirStat(path);
  const filtered = (flags.all as boolean)
    ? entries
    : entries.filter((e) => !e.name.startsWith('.'));
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered;
}

const command: Command = async (ctx) => {
  const { flags, positional } = parseArgs(ctx.args, spec);
  const targets = positional.length > 0 ? positional : [ctx.cwd];

  let exitCode = 0;
  const fileEntries: LsEntry[] = [];
  const dirTargets: string[] = [];

  // First pass: separate files from directories
  for (const target of targets) {
    const targetPath = resolve(ctx.cwd, target);
    try {
      const stat = ctx.vfs.stat(targetPath);
      if (stat.type === 'file') {
        fileEntries.push({
          name: target,
          type: stat.type,
          size: stat.size,
          mtime: stat.mtime,
          mode: stat.mode,
        });
      } else {
        dirTargets.push(target);
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`ls: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  // Display file entries
  if (fileEntries.length > 0) {
    if (flags.long) {
      for (const entry of fileEntries) {
        ctx.stdout.write(formatEntry(entry, true));
      }
    } else if (flags.one) {
      for (const entry of fileEntries) {
        ctx.stdout.write(formatEntry(entry, false) + '\n');
      }
    } else {
      const names = fileEntries.map((e) => formatEntry(e, false));
      ctx.stdout.write(names.join('  ') + '\n');
    }
  }

  // Display directory entries
  for (let i = 0; i < dirTargets.length; i++) {
    const target = dirTargets[i];
    const targetPath = resolve(ctx.cwd, target);

    // Print header if multiple targets
    if (dirTargets.length > 1 || fileEntries.length > 0) {
      if (fileEntries.length > 0 || i > 0) ctx.stdout.write('\n');
      ctx.stdout.write(`${target}:\n`);
    }

    try {
      const entries = listDirectory(targetPath, flags, ctx);

      if (flags.long) {
        for (const entry of entries) {
          ctx.stdout.write(formatEntry(entry, true));
        }
      } else if (flags.one) {
        for (const entry of entries) {
          ctx.stdout.write(formatEntry(entry, false) + '\n');
        }
      } else {
        const names = entries.map((e) => formatEntry(e, false));
        if (names.length > 0) {
          ctx.stdout.write(names.join('  ') + '\n');
        }
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`ls: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
