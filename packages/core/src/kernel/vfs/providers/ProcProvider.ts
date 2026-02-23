import type { VirtualProvider, Stat, Dirent } from '../types.js';
import { VFSError, ErrorCode } from '../types.js';
import { encode } from '../../../utils/encoding.js';

export class ProcProvider implements VirtualProvider {
  private generators = new Map<string, () => string>();

  constructor() {
    this.generators.set('cpuinfo', () => {
      const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency ?? 1
        : 1;
      const lines: string[] = [];
      for (let i = 0; i < cores; i++) {
        lines.push(`processor\t: ${i}`);
        lines.push(`model name\t: Browser Virtual CPU`);
        lines.push(`cpu cores\t: ${cores}`);
        lines.push('');
      }
      return lines.join('\n');
    });

    this.generators.set('meminfo', () => {
      const perf = typeof performance !== 'undefined' ? performance : null;
      const memory = (perf as unknown as { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number; totalJSHeapSize: number } })?.memory;
      if (memory) {
        const totalKB = Math.floor(memory.jsHeapSizeLimit / 1024);
        const usedKB = Math.floor(memory.usedJSHeapSize / 1024);
        const freeKB = totalKB - usedKB;
        return [
          `MemTotal:       ${totalKB} kB`,
          `MemFree:        ${freeKB} kB`,
          `MemUsed:        ${usedKB} kB`,
          `HeapTotal:      ${Math.floor(memory.totalJSHeapSize / 1024)} kB`,
          '',
        ].join('\n');
      }
      return [
        'MemTotal:       2097152 kB',
        'MemFree:        1048576 kB',
        'MemUsed:        1048576 kB',
        '',
      ].join('\n');
    });

    this.generators.set('uptime', () => {
      const seconds = typeof performance !== 'undefined'
        ? (performance.now() / 1000).toFixed(2)
        : '0.00';
      return `${seconds} ${seconds}\n`;
    });

    this.generators.set('version', () => {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js';
      return `Lifo 1.0.0 (${ua})\n`;
    });
  }

  private isNetPath(subpath: string): boolean {
    return subpath === '/net' || subpath === '/net/info';
  }

  private getNetInfo(): string {
    const conn = typeof navigator !== 'undefined'
      ? (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; type?: string } }).connection
      : undefined;
    if (conn) {
      return [
        `type:          ${conn.type ?? 'unknown'}`,
        `effectiveType: ${conn.effectiveType ?? 'unknown'}`,
        `downlink:      ${conn.downlink ?? 0} Mbps`,
        `rtt:           ${conn.rtt ?? 0} ms`,
        '',
      ].join('\n');
    }
    return 'Network information not available\n';
  }

  private generate(subpath: string): string {
    // Normalize: '/cpuinfo' -> 'cpuinfo'
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;

    if (name === 'net/info') {
      return this.getNetInfo();
    }

    const gen = this.generators.get(name);
    if (!gen) {
      throw new VFSError(ErrorCode.ENOENT, `'/proc${subpath}': no such file`);
    }
    return gen();
  }

  readFile(subpath: string): Uint8Array {
    return encode(this.readFileString(subpath));
  }

  readFileString(subpath: string): string {
    return this.generate(subpath);
  }

  exists(subpath: string): boolean {
    if (subpath === '/') return true;
    if (this.isNetPath(subpath)) return true;
    const name = subpath.startsWith('/') ? subpath.slice(1) : subpath;
    return this.generators.has(name);
  }

  stat(subpath: string): Stat {
    if (!this.exists(subpath)) {
      throw new VFSError(ErrorCode.ENOENT, `'/proc${subpath}': no such file`);
    }

    if (subpath === '/' || subpath === '/net') {
      return { type: 'directory', size: 0, ctime: 0, mtime: Date.now(), mode: 0o555 };
    }

    const content = this.generate(subpath);
    return {
      type: 'file',
      size: content.length,
      ctime: 0,
      mtime: Date.now(),
      mode: 0o444,
    };
  }

  readdir(subpath: string): Dirent[] {
    if (subpath === '/') {
      const entries: Dirent[] = [];
      for (const name of this.generators.keys()) {
        entries.push({ name, type: 'file' });
      }
      entries.push({ name: 'net', type: 'directory' });
      return entries;
    }

    if (subpath === '/net') {
      return [{ name: 'info', type: 'file' }];
    }

    throw new VFSError(ErrorCode.ENOTDIR, `'/proc${subpath}': not a directory`);
  }
}
