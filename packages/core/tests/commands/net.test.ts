import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';

function createContext(
  vfs: VFS,
  args: string[],
  cwd = '/',
  env: Record<string, string> = {},
): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env,
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
  };
}

describe('curl', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches a URL and writes response to stdout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{"hello": "world"}'),
      headers: new Headers(),
    });

    const vfs = new VFS();
    const { default: curl } = await import('../../src/commands/net/curl.js');
    const ctx = createContext(vfs, ['https://example.com/api']);
    const code = await curl(ctx);

    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('{"hello": "world"}');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'GET' }));
  });

  it('uses correct HTTP method with -X', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('ok'),
      headers: new Headers(),
    });

    const vfs = new VFS();
    const { default: curl } = await import('../../src/commands/net/curl.js');
    const ctx = createContext(vfs, ['-X', 'POST', 'https://example.com']);
    await curl(ctx);

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ method: 'POST' }));
  });

  it('passes headers with -H', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('ok'),
      headers: new Headers(),
    });

    const vfs = new VFS();
    const { default: curl } = await import('../../src/commands/net/curl.js');
    const ctx = createContext(vfs, ['-H', 'Content-Type: application/json', 'https://example.com']);
    await curl(ctx);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('saves to file with -o', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('file content'),
      headers: new Headers(),
    });

    const vfs = new VFS();
    const { default: curl } = await import('../../src/commands/net/curl.js');
    const ctx = createContext(vfs, ['-o', '/output.txt', 'https://example.com']);
    const code = await curl(ctx);

    expect(code).toBe(0);
    expect(vfs.readFileString('/output.txt')).toBe('file content');
  });

  it('returns error code for missing URL', async () => {
    const vfs = new VFS();
    const { default: curl } = await import('../../src/commands/net/curl.js');
    const ctx = createContext(vfs, []);
    const code = await curl(ctx);

    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('no URL');
  });
});

describe('wget', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads file and saves with default name', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('downloaded content'),
    });

    const vfs = new VFS();
    const { default: wget } = await import('../../src/commands/net/wget.js');
    const ctx = createContext(vfs, ['https://example.com/file.txt']);
    const code = await wget(ctx);

    expect(code).toBe(0);
    expect(vfs.readFileString('/file.txt')).toBe('downloaded content');
  });

  it('saves to custom file with -O', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('content'),
    });

    const vfs = new VFS();
    const { default: wget } = await import('../../src/commands/net/wget.js');
    const ctx = createContext(vfs, ['-O', '/custom.html', 'https://example.com/page']);
    const code = await wget(ctx);

    expect(code).toBe(0);
    expect(vfs.readFileString('/custom.html')).toBe('content');
  });
});

describe('ping', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends multiple fetch calls based on count', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const vfs = new VFS();
    const { default: ping } = await import('../../src/commands/net/ping.js');
    const ctx = createContext(vfs, ['-c', '2', 'example.com']);
    const code = await ping(ctx);

    expect(code).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(ctx.stdout.text).toContain('PING example.com');
    expect(ctx.stdout.text).toContain('ping statistics');
    expect(ctx.stdout.text).toContain('2 packets transmitted');
  });

  it('returns error for missing host', async () => {
    const vfs = new VFS();
    const { default: ping } = await import('../../src/commands/net/ping.js');
    const ctx = createContext(vfs, []);
    const code = await ping(ctx);

    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('missing host');
  });
});

describe('dig', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('queries DNS and displays answer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        Status: 0,
        Question: [{ name: 'example.com', type: 1 }],
        Answer: [
          { name: 'example.com', type: 1, TTL: 300, data: '93.184.216.34' },
        ],
      }),
    });

    const vfs = new VFS();
    const { default: dig } = await import('../../src/commands/net/dig.js');
    const ctx = createContext(vfs, ['example.com']);
    const code = await dig(ctx);

    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('ANSWER SECTION');
    expect(ctx.stdout.text).toContain('93.184.216.34');
    expect(ctx.stdout.text).toContain('example.com');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('dns.google/resolve'),
      expect.any(Object),
    );
  });

  it('returns error for missing domain', async () => {
    const vfs = new VFS();
    const { default: dig } = await import('../../src/commands/net/dig.js');
    const ctx = createContext(vfs, []);
    const code = await dig(ctx);

    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('missing domain');
  });
});
