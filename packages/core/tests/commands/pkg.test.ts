import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import { createPkgCommand } from '../../src/commands/system/pkg.js';
import type { CommandContext, CommandOutputStream } from '../../src/commands/types.js';

function createContext(vfs: VFS, args: string[], cwd = '/'): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env: { HOME: '/home/user', USER: 'user' },
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
  };
}

describe('pkg command', () => {
  let vfs: VFS;
  let registry: CommandRegistry;
  let pkg: ReturnType<typeof createPkgCommand>;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/usr', { recursive: true });
    vfs.mkdir('/usr/share', { recursive: true });
    vfs.mkdir('/usr/share/pkg', { recursive: true });
    vfs.mkdir('/usr/share/pkg/node_modules', { recursive: true });
    registry = new CommandRegistry();
    pkg = createPkgCommand(registry);
  });

  it('pkg list shows empty initially', async () => {
    const ctx = createContext(vfs, ['list']);
    const code = await pkg(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('No packages');
  });

  it('pkg install fetches and saves package', async () => {
    const mockSource = 'console.log("hello from pkg");';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(mockSource, { status: 200 }),
    );

    const ctx = createContext(vfs, ['install', 'https://example.com/hello.js', 'hello']);
    const code = await pkg(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Installed hello');
    expect(vfs.exists('/usr/share/pkg/node_modules/hello/index.js')).toBe(true);
    expect(vfs.readFileString('/usr/share/pkg/node_modules/hello/index.js')).toBe(mockSource);

    vi.restoreAllMocks();
  });

  it('pkg remove removes package', async () => {
    // Setup: manually install a package
    vfs.mkdir('/usr/share/pkg/node_modules/mytest', { recursive: true });
    vfs.writeFile('/usr/share/pkg/node_modules/mytest/index.js', 'module.exports = {}');
    vfs.writeFile('/usr/share/pkg/packages.json', JSON.stringify({
      packages: {
        mytest: { name: 'mytest', url: 'https://example.com/mytest.js', installedAt: Date.now(), size: 20 },
      },
    }));

    const ctx = createContext(vfs, ['remove', 'mytest']);
    const code = await pkg(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Removed mytest');
  });

  it('pkg info shows package details', async () => {
    vfs.writeFile('/usr/share/pkg/packages.json', JSON.stringify({
      packages: {
        testpkg: { name: 'testpkg', url: 'https://example.com/testpkg.js', installedAt: 1700000000000, size: 100 },
      },
    }));

    const ctx = createContext(vfs, ['info', 'testpkg']);
    const code = await pkg(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('testpkg');
    expect(ctx.stdout.text).toContain('100 bytes');
  });

  it('pkg info errors for missing package', async () => {
    const ctx = createContext(vfs, ['info', 'nonexistent']);
    const code = await pkg(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('not found');
  });

  it('pkg install errors on failed fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 404, statusText: 'Not Found' }),
    );

    const ctx = createContext(vfs, ['install', 'https://example.com/bad.js']);
    const code = await pkg(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('install failed');

    vi.restoreAllMocks();
  });

  it('pkg with no args shows help', async () => {
    const ctx = createContext(vfs, []);
    const code = await pkg(ctx);
    expect(code).toBe(1);
    expect(ctx.stdout.text).toContain('Usage');
  });
});
