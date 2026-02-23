import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { ProcProvider } from '../../src/kernel/vfs/providers/ProcProvider.js';
import { DevProvider } from '../../src/kernel/vfs/providers/DevProvider.js';
import type { VirtualProvider } from '../../src/kernel/vfs/types.js';

describe('VFS Virtual Provider System', () => {
  it('delegates readFileString to registered provider', () => {
    const vfs = new VFS();
    const mock: VirtualProvider = {
      readFile: () => new Uint8Array([72, 105]),
      readFileString: () => 'Hi',
      exists: () => true,
      stat: () => ({ type: 'file', size: 2, ctime: 0, mtime: 0, mode: 0o444 }),
      readdir: () => [],
    };
    vfs.registerProvider('/mock', mock);
    expect(vfs.readFileString('/mock/test')).toBe('Hi');
  });

  it('delegates exists to registered provider', () => {
    const vfs = new VFS();
    const mock: VirtualProvider = {
      readFile: () => new Uint8Array(0),
      readFileString: () => '',
      exists: (sub) => sub === '/test',
      stat: () => ({ type: 'file', size: 0, ctime: 0, mtime: 0, mode: 0o444 }),
      readdir: () => [],
    };
    vfs.registerProvider('/mock', mock);
    expect(vfs.exists('/mock/test')).toBe(true);
    expect(vfs.exists('/mock/nope')).toBe(false);
  });

  it('delegates stat to registered provider', () => {
    const vfs = new VFS();
    const mock: VirtualProvider = {
      readFile: () => new Uint8Array(0),
      readFileString: () => '',
      exists: () => true,
      stat: () => ({ type: 'file', size: 42, ctime: 100, mtime: 200, mode: 0o444 }),
      readdir: () => [],
    };
    vfs.registerProvider('/mock', mock);
    const s = vfs.stat('/mock/something');
    expect(s.type).toBe('file');
    expect(s.size).toBe(42);
  });

  it('delegates writeFile to provider when writeFile is defined', () => {
    const vfs = new VFS();
    let written = '';
    const mock: VirtualProvider = {
      readFile: () => new Uint8Array(0),
      readFileString: () => '',
      writeFile: (_sub, content) => { written = typeof content === 'string' ? content : ''; },
      exists: () => true,
      stat: () => ({ type: 'file', size: 0, ctime: 0, mtime: 0, mode: 0o666 }),
      readdir: () => [],
    };
    vfs.registerProvider('/mock', mock);
    vfs.writeFile('/mock/test', 'hello');
    expect(written).toBe('hello');
  });

  it('non-virtual paths still work normally', () => {
    const vfs = new VFS();
    vfs.registerProvider('/mock', {
      readFile: () => new Uint8Array(0),
      readFileString: () => 'virtual',
      exists: () => true,
      stat: () => ({ type: 'file', size: 0, ctime: 0, mtime: 0, mode: 0o444 }),
      readdir: () => [],
    });

    vfs.writeFile('/realfile', 'real content');
    expect(vfs.readFileString('/realfile')).toBe('real content');
    expect(vfs.exists('/realfile')).toBe(true);
  });

  it('virtual provider dirs appear in root readdir', () => {
    const vfs = new VFS();
    vfs.registerProvider('/virtual', {
      readFile: () => new Uint8Array(0),
      readFileString: () => '',
      exists: () => true,
      stat: () => ({ type: 'directory', size: 0, ctime: 0, mtime: 0, mode: 0o555 }),
      readdir: () => [],
    });

    vfs.mkdir('/real');
    const entries = vfs.readdir('/');
    const names = entries.map((e) => e.name);
    expect(names).toContain('real');
    expect(names).toContain('virtual');
  });
});

describe('ProcProvider', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.registerProvider('/proc', new ProcProvider());
  });

  it('/proc/uptime returns a number', () => {
    const content = vfs.readFileString('/proc/uptime');
    const seconds = parseFloat(content.split(' ')[0]);
    expect(seconds).toBeGreaterThanOrEqual(0);
  });

  it('/proc/cpuinfo contains processor', () => {
    const content = vfs.readFileString('/proc/cpuinfo');
    expect(content).toContain('processor');
  });

  it('/proc/meminfo contains MemTotal', () => {
    const content = vfs.readFileString('/proc/meminfo');
    expect(content).toContain('MemTotal');
  });

  it('/proc/version contains Lifo', () => {
    const content = vfs.readFileString('/proc/version');
    expect(content).toContain('Lifo');
  });

  it('readdir on /proc returns expected entries', () => {
    const entries = vfs.readdir('/proc');
    const names = entries.map((e) => e.name);
    expect(names).toContain('cpuinfo');
    expect(names).toContain('meminfo');
    expect(names).toContain('uptime');
    expect(names).toContain('version');
    expect(names).toContain('net');
  });

  it('stat on /proc returns directory', () => {
    const s = vfs.stat('/proc');
    expect(s.type).toBe('directory');
  });

  it('stat on /proc/uptime returns file', () => {
    const s = vfs.stat('/proc/uptime');
    expect(s.type).toBe('file');
  });

  it('exists works for /proc paths', () => {
    expect(vfs.exists('/proc')).toBe(true);
    expect(vfs.exists('/proc/uptime')).toBe(true);
    expect(vfs.exists('/proc/nonexistent')).toBe(false);
  });

  it('/proc/net/info exists', () => {
    expect(vfs.exists('/proc/net/info')).toBe(true);
    const entries = vfs.readdir('/proc/net');
    expect(entries.map((e) => e.name)).toContain('info');
  });
});

describe('DevProvider', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.registerProvider('/dev', new DevProvider());
  });

  it('/dev/null read returns empty', () => {
    const content = vfs.readFile('/dev/null');
    expect(content.length).toBe(0);
  });

  it('/dev/null readFileString returns empty string', () => {
    expect(vfs.readFileString('/dev/null')).toBe('');
  });

  it('/dev/null write succeeds silently', () => {
    expect(() => vfs.writeFile('/dev/null', 'discard me')).not.toThrow();
  });

  it('/dev/zero returns zero bytes', () => {
    const content = vfs.readFile('/dev/zero');
    expect(content.length).toBe(1024);
    expect(content.every((b) => b === 0)).toBe(true);
  });

  it('/dev/random returns bytes', () => {
    const content = vfs.readFile('/dev/random');
    expect(content.length).toBe(256);
  });

  it('/dev/urandom returns bytes', () => {
    const content = vfs.readFile('/dev/urandom');
    expect(content.length).toBe(256);
  });

  it('readdir on /dev returns device names', () => {
    const entries = vfs.readdir('/dev');
    const names = entries.map((e) => e.name);
    expect(names).toContain('null');
    expect(names).toContain('zero');
    expect(names).toContain('random');
    expect(names).toContain('urandom');
    expect(names).toContain('clipboard');
  });

  it('stat on /dev returns directory', () => {
    const s = vfs.stat('/dev');
    expect(s.type).toBe('directory');
  });

  it('stat on /dev/null returns file', () => {
    const s = vfs.stat('/dev/null');
    expect(s.type).toBe('file');
  });

  it('exists works for /dev paths', () => {
    expect(vfs.exists('/dev')).toBe(true);
    expect(vfs.exists('/dev/null')).toBe(true);
    expect(vfs.exists('/dev/zero')).toBe(true);
    expect(vfs.exists('/dev/nonexistent')).toBe(false);
  });
});
