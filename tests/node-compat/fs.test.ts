import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { createFs } from '../../src/node-compat/fs.js';

describe('node-compat fs', () => {
  let vfs: VFS;
  let fs: ReturnType<typeof createFs>;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home');
    vfs.mkdir('/tmp');
    fs = createFs(vfs, '/');
  });

  describe('sync API', () => {
    it('readFileSync returns string with encoding', () => {
      vfs.writeFile('/tmp/test.txt', 'hello');
      const content = fs.readFileSync('/tmp/test.txt', 'utf-8');
      expect(content).toBe('hello');
    });

    it('readFileSync returns Uint8Array without encoding', () => {
      vfs.writeFile('/tmp/test.txt', 'hello');
      const content = fs.readFileSync('/tmp/test.txt');
      expect(content).toBeInstanceOf(Uint8Array);
    });

    it('writeFileSync + readFileSync round-trip', () => {
      fs.writeFileSync('/tmp/out.txt', 'written content');
      expect(fs.readFileSync('/tmp/out.txt', 'utf-8')).toBe('written content');
    });

    it('existsSync returns true/false', () => {
      vfs.writeFile('/tmp/exists.txt', 'yes');
      expect(fs.existsSync('/tmp/exists.txt')).toBe(true);
      expect(fs.existsSync('/tmp/nope.txt')).toBe(false);
    });

    it('statSync returns object with isFile()/isDirectory()', () => {
      vfs.writeFile('/tmp/file.txt', 'data');
      const fileStat = fs.statSync('/tmp/file.txt');
      expect(fileStat.isFile()).toBe(true);
      expect(fileStat.isDirectory()).toBe(false);

      const dirStat = fs.statSync('/tmp');
      expect(dirStat.isFile()).toBe(false);
      expect(dirStat.isDirectory()).toBe(true);
    });

    it('mkdirSync with recursive: true', () => {
      fs.mkdirSync('/tmp/a/b/c', { recursive: true });
      expect(fs.existsSync('/tmp/a/b/c')).toBe(true);
    });

    it('readdirSync returns string array', () => {
      vfs.writeFile('/tmp/x.txt', '');
      vfs.writeFile('/tmp/y.txt', '');
      const entries = fs.readdirSync('/tmp');
      expect(entries).toContain('x.txt');
      expect(entries).toContain('y.txt');
    });

    it('unlinkSync removes file', () => {
      vfs.writeFile('/tmp/del.txt', 'bye');
      fs.unlinkSync('/tmp/del.txt');
      expect(fs.existsSync('/tmp/del.txt')).toBe(false);
    });

    it('renameSync moves file', () => {
      vfs.writeFile('/tmp/old.txt', 'data');
      fs.renameSync('/tmp/old.txt', '/tmp/new.txt');
      expect(fs.existsSync('/tmp/old.txt')).toBe(false);
      expect(fs.readFileSync('/tmp/new.txt', 'utf-8')).toBe('data');
    });

    it('copyFileSync copies file', () => {
      vfs.writeFile('/tmp/src.txt', 'copy me');
      fs.copyFileSync('/tmp/src.txt', '/tmp/dst.txt');
      expect(fs.readFileSync('/tmp/dst.txt', 'utf-8')).toBe('copy me');
    });

    it('appendFileSync appends data', () => {
      vfs.writeFile('/tmp/app.txt', 'a');
      fs.appendFileSync('/tmp/app.txt', 'b');
      expect(fs.readFileSync('/tmp/app.txt', 'utf-8')).toBe('ab');
    });

    it('accessSync throws for missing file', () => {
      expect(() => fs.accessSync('/tmp/missing')).toThrow();
    });
  });

  describe('callback API', () => {
    it('readFile invokes callback asynchronously', async () => {
      vfs.writeFile('/tmp/cb.txt', 'callback');
      const result = await new Promise<string>((resolve, reject) => {
        fs.readFile('/tmp/cb.txt', 'utf-8', (err, data) => {
          if (err) reject(err);
          else resolve(data as string);
        });
      });
      expect(result).toBe('callback');
    });

    it('stat callback provides stat object', async () => {
      vfs.writeFile('/tmp/stat.txt', 'data');
      const stat = await new Promise<{ isFile: () => boolean }>((resolve, reject) => {
        fs.stat('/tmp/stat.txt', (err, result) => {
          if (err) reject(err);
          else resolve(result as { isFile: () => boolean });
        });
      });
      expect(stat.isFile()).toBe(true);
    });
  });

  describe('promises API', () => {
    it('readFile returns Promise', async () => {
      vfs.writeFile('/tmp/prom.txt', 'promised');
      const content = await fs.promises.readFile('/tmp/prom.txt', 'utf-8');
      expect(content).toBe('promised');
    });

    it('writeFile writes via Promise', async () => {
      await fs.promises.writeFile('/tmp/pw.txt', 'async write');
      expect(vfs.readFileString('/tmp/pw.txt')).toBe('async write');
    });

    it('stat returns Promise', async () => {
      vfs.writeFile('/tmp/ps.txt', 'x');
      const stat = await fs.promises.stat('/tmp/ps.txt');
      expect(stat.isFile()).toBe(true);
    });

    it('mkdir creates directory', async () => {
      await fs.promises.mkdir('/tmp/pdir', { recursive: true });
      expect(vfs.exists('/tmp/pdir')).toBe(true);
    });

    it('readdir returns array', async () => {
      vfs.writeFile('/tmp/rd1.txt', '');
      const entries = await fs.promises.readdir('/tmp');
      expect(entries).toContain('rd1.txt');
    });

    it('rm with force ignores missing', async () => {
      await expect(fs.promises.rm('/tmp/nonexistent', { force: true })).resolves.toBeUndefined();
    });
  });
});
