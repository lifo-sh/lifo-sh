import type { VFS } from '../kernel/vfs/index.js';

const HISTORY_PATH = '/home/user/.bash_history';
const MAX_HISTORY = 1000;

export class HistoryManager {
  private entries: string[] = [];
  private vfs: VFS;

  constructor(vfs: VFS) {
    this.vfs = vfs;
  }

  load(): void {
    try {
      const content = this.vfs.readFileString(HISTORY_PATH);
      this.entries = content.split('\n').filter(Boolean);
    } catch {
      this.entries = [];
    }
  }

  save(): void {
    try {
      this.vfs.writeFile(HISTORY_PATH, this.entries.join('\n') + '\n');
    } catch {
      // Ignore write errors (directory may not exist)
    }
  }

  add(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Deduplicate consecutive repeats
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      return;
    }

    this.entries.push(trimmed);

    // Trim to max
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(-MAX_HISTORY);
    }

    this.save();
  }

  /**
   * Expand history references:
   * !! -> last command
   * !n -> nth command (1-based)
   * !-n -> nth from end
   * !prefix -> most recent command starting with prefix
   * Returns null if no expansion needed.
   */
  expand(line: string): string | null {
    if (!line.includes('!')) return null;

    // !! -- last command
    if (line.includes('!!')) {
      if (this.entries.length === 0) return null;
      return line.replace(/!!/g, this.entries[this.entries.length - 1]);
    }

    // !-n -- nth from end
    const negMatch = line.match(/^!-(\d+)$/);
    if (negMatch) {
      const n = parseInt(negMatch[1], 10);
      const idx = this.entries.length - n;
      if (idx >= 0 && idx < this.entries.length) {
        return this.entries[idx];
      }
      return null;
    }

    // !n -- nth command (1-based)
    const numMatch = line.match(/^!(\d+)$/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10) - 1;
      if (n >= 0 && n < this.entries.length) {
        return this.entries[n];
      }
      return null;
    }

    // !prefix -- most recent match
    const prefixMatch = line.match(/^!([a-zA-Z/].*)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      for (let i = this.entries.length - 1; i >= 0; i--) {
        if (this.entries[i].startsWith(prefix)) {
          return this.entries[i];
        }
      }
      return null;
    }

    return null;
  }

  get(index: number): string | undefined {
    return this.entries[index];
  }

  getAll(): string[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }
}
