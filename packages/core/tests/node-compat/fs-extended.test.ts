import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { createFs } from '../../src/node-compat/fs.js';

describe('node-compat fs extended', () => {
  let vfs: VFS;
  let fs: ReturnType<typeof createFs>;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home');
    vfs.mkdir('/home/user');
    vfs.writeFile('/home/user/hello.txt', 'Hello, world!');
    vfs.writeFile('/home/user/data.bin', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    fs = createFs(vfs, '/home/user');
  });

  describe('openSync / closeSync', () => {
    it('opens a file and returns a file descriptor, then closes it', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'r');
      expect(typeof fd).toBe('number');
      expect(fd).toBeGreaterThanOrEqual(10);
      fs.closeSync(fd);
    });

    it('throws EBADF when using a closed fd', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'r');
      fs.closeSync(fd);
      expect(() => fs.fstatSync(fd)).toThrow();
    });
  });

  describe('readSync', () => {
    it('reads bytes from fd into buffer', () => {
      const fd = fs.openSync('/home/user/data.bin', 'r');
      const buf = new Uint8Array(4);
      const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
      expect(bytesRead).toBe(4);
      expect(buf).toEqual(new Uint8Array([0, 1, 2, 3]));
      fs.closeSync(fd);
    });

    it('reads from current position when position is null', () => {
      const fd = fs.openSync('/home/user/data.bin', 'r');
      const buf1 = new Uint8Array(3);
      fs.readSync(fd, buf1, 0, 3, null);
      expect(buf1).toEqual(new Uint8Array([0, 1, 2]));

      const buf2 = new Uint8Array(3);
      fs.readSync(fd, buf2, 0, 3, null);
      expect(buf2).toEqual(new Uint8Array([3, 4, 5]));
      fs.closeSync(fd);
    });

    it('returns 0 when reading past end of file', () => {
      const fd = fs.openSync('/home/user/data.bin', 'r');
      const buf = new Uint8Array(4);
      const bytesRead = fs.readSync(fd, buf, 0, 4, 100);
      expect(bytesRead).toBe(0);
      fs.closeSync(fd);
    });
  });

  describe('writeSync', () => {
    it('writes bytes via fd', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'w');
      const data = new TextEncoder().encode('New content');
      const written = fs.writeSync(fd, data, 0, data.length, 0);
      expect(written).toBe(data.length);
      fs.closeSync(fd);
      expect(fs.readFileSync('/home/user/hello.txt', 'utf-8')).toBe('New content');
    });

    it('writes a string via fd', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'w');
      fs.writeSync(fd, 'string write');
      fs.closeSync(fd);
      expect(fs.readFileSync('/home/user/hello.txt', 'utf-8')).toBe('string write');
    });
  });

  describe('fstatSync', () => {
    it('returns stat via fd', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'r');
      const stat = fs.fstatSync(fd);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
      fs.closeSync(fd);
    });
  });

  describe('realpathSync', () => {
    it('returns absolute path for existing file', () => {
      const result = fs.realpathSync('hello.txt');
      expect(result).toBe('/home/user/hello.txt');
    });

    it('returns absolute path for directory', () => {
      const result = fs.realpathSync('/home/user');
      expect(result).toBe('/home/user');
    });

    it('throws ENOENT for missing path', () => {
      expect(() => fs.realpathSync('/nonexistent/path')).toThrow();
      try {
        fs.realpathSync('/nonexistent/path');
      } catch (e: unknown) {
        expect((e as { code: string }).code).toBe('ENOENT');
      }
    });
  });

  describe('truncateSync', () => {
    it('truncates file to given length', () => {
      fs.truncateSync('/home/user/hello.txt', 5);
      const content = fs.readFileSync('/home/user/hello.txt', 'utf-8');
      expect(content).toBe('Hello');
    });

    it('truncates file to 0 when no length given', () => {
      fs.truncateSync('/home/user/hello.txt');
      const content = fs.readFileSync('/home/user/hello.txt', 'utf-8');
      expect(content).toBe('');
    });
  });

  describe('createReadStream', () => {
    it('emits data and end events with file content', async () => {
      const stream = fs.createReadStream('/home/user/hello.txt');
      const chunks: string[] = [];

      await new Promise<void>((resolve) => {
        stream.on('data', (chunk) => {
          chunks.push(chunk as string);
        });
        stream.on('end', () => {
          resolve();
        });
      });

      expect(chunks.join('')).toBe('Hello, world!');
    });
  });

  describe('createWriteStream', () => {
    it('writes data to file', () => {
      const stream = fs.createWriteStream('/home/user/output.txt');
      stream.write('first ');
      stream.write('second');
      stream.end();

      const content = fs.readFileSync('/home/user/output.txt', 'utf-8');
      expect(content).toBe('first second');
    });

    it('emits finish event on end', async () => {
      const stream = fs.createWriteStream('/home/user/output2.txt');
      const finished = new Promise<void>((resolve) => {
        stream.on('finish', () => resolve());
      });
      stream.write('data');
      stream.end();
      await finished;
    });
  });

  describe('openSync with w flag', () => {
    it('truncates existing file', () => {
      expect(fs.readFileSync('/home/user/hello.txt', 'utf-8')).toBe('Hello, world!');
      const fd = fs.openSync('/home/user/hello.txt', 'w');
      fs.closeSync(fd);
      expect(fs.readFileSync('/home/user/hello.txt', 'utf-8')).toBe('');
    });
  });

  describe('openSync with a flag', () => {
    it('positions at end of file for appending', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'a');
      fs.writeSync(fd, '!!!');
      fs.closeSync(fd);

      const content = fs.readFileSync('/home/user/hello.txt', 'utf-8');
      expect(content).toContain('Hello, world!');
      expect(content).toContain('!!!');
    });
  });

  describe('ftruncateSync', () => {
    it('truncates file via fd', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'r+');
      fs.ftruncateSync(fd, 5);
      fs.closeSync(fd);
      const content = fs.readFileSync('/home/user/hello.txt', 'utf-8');
      expect(content).toBe('Hello');
    });

    it('truncates to 0 when no length given', () => {
      const fd = fs.openSync('/home/user/hello.txt', 'r+');
      fs.ftruncateSync(fd);
      fs.closeSync(fd);
      const content = fs.readFileSync('/home/user/hello.txt', 'utf-8');
      expect(content).toBe('');
    });
  });
});
