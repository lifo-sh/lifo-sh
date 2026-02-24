import { describe, it, expect, beforeEach } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import type { VFSWatchEvent } from '../../src/kernel/vfs/index.js';

describe('VFS watch', () => {
  let vfs: VFS;
  let events: VFSWatchEvent[];

  beforeEach(() => {
    vfs = new VFS();
    events = [];
  });

  describe('global watch', () => {
    it('emits create on writeFile for new file', () => {
      vfs.watch((e) => events.push(e));
      vfs.writeFile('/file.txt', 'hello');
      expect(events).toEqual([
        { type: 'create', path: '/file.txt', fileType: 'file' },
      ]);
    });

    it('emits modify on writeFile for existing file', () => {
      vfs.writeFile('/file.txt', 'first');
      vfs.watch((e) => events.push(e));
      vfs.writeFile('/file.txt', 'second');
      expect(events).toEqual([
        { type: 'modify', path: '/file.txt', fileType: 'file' },
      ]);
    });

    it('emits create on mkdir', () => {
      vfs.watch((e) => events.push(e));
      vfs.mkdir('/dir');
      expect(events).toEqual([
        { type: 'create', path: '/dir', fileType: 'directory' },
      ]);
    });

    it('emits multiple creates on mkdir recursive', () => {
      vfs.watch((e) => events.push(e));
      vfs.mkdir('/a/b/c', { recursive: true });
      expect(events).toEqual([
        { type: 'create', path: '/a', fileType: 'directory' },
        { type: 'create', path: '/a/b', fileType: 'directory' },
        { type: 'create', path: '/a/b/c', fileType: 'directory' },
      ]);
    });

    it('emits delete on unlink', () => {
      vfs.writeFile('/file.txt', 'data');
      vfs.watch((e) => events.push(e));
      vfs.unlink('/file.txt');
      expect(events).toEqual([
        { type: 'delete', path: '/file.txt', fileType: 'file' },
      ]);
    });

    it('emits delete on rmdir', () => {
      vfs.mkdir('/dir');
      vfs.watch((e) => events.push(e));
      vfs.rmdir('/dir');
      expect(events).toEqual([
        { type: 'delete', path: '/dir', fileType: 'directory' },
      ]);
    });

    it('emits rename event', () => {
      vfs.writeFile('/old.txt', 'data');
      vfs.watch((e) => events.push(e));
      vfs.rename('/old.txt', '/new.txt');
      expect(events).toEqual([
        { type: 'rename', path: '/new.txt', oldPath: '/old.txt', fileType: 'file' },
      ]);
    });

    it('emits modify on appendFile for existing file', () => {
      vfs.writeFile('/file.txt', 'hello');
      vfs.watch((e) => events.push(e));
      vfs.appendFile('/file.txt', ' world');
      expect(events).toEqual([
        { type: 'modify', path: '/file.txt', fileType: 'file' },
      ]);
    });

    it('emits create on appendFile for new file', () => {
      vfs.watch((e) => events.push(e));
      vfs.appendFile('/new.txt', 'content');
      expect(events).toEqual([
        { type: 'create', path: '/new.txt', fileType: 'file' },
      ]);
    });

    it('emits modify on touch for existing file', () => {
      vfs.writeFile('/file.txt', 'data');
      vfs.watch((e) => events.push(e));
      vfs.touch('/file.txt');
      expect(events).toEqual([
        { type: 'modify', path: '/file.txt', fileType: 'file' },
      ]);
    });

    it('emits create on touch for new file', () => {
      vfs.watch((e) => events.push(e));
      vfs.touch('/new.txt');
      expect(events).toEqual([
        { type: 'create', path: '/new.txt', fileType: 'file' },
      ]);
    });

    it('emits create on copyFile', () => {
      vfs.writeFile('/src.txt', 'data');
      vfs.watch((e) => events.push(e));
      vfs.copyFile('/src.txt', '/dst.txt');
      expect(events).toEqual([
        { type: 'create', path: '/dst.txt', fileType: 'file' },
      ]);
    });
  });

  describe('scoped watch', () => {
    it('only fires for events under watched path', () => {
      vfs.mkdir('/a');
      vfs.mkdir('/b');
      vfs.watch('/a', (e) => events.push(e));
      vfs.writeFile('/a/file.txt', 'hello');
      vfs.writeFile('/b/file.txt', 'world');
      expect(events).toEqual([
        { type: 'create', path: '/a/file.txt', fileType: 'file' },
      ]);
    });

    it('fires for the exact watched path', () => {
      vfs.watch('/file.txt', (e) => events.push(e));
      vfs.writeFile('/file.txt', 'hello');
      expect(events.length).toBe(1);
    });

    it('fires for rename when oldPath matches scope', () => {
      vfs.mkdir('/src');
      vfs.mkdir('/dst');
      vfs.writeFile('/src/file.txt', 'data');
      vfs.watch('/src', (e) => events.push(e));
      vfs.rename('/src/file.txt', '/dst/file.txt');
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('rename');
    });
  });

  describe('unwatch', () => {
    it('stops receiving events after unwatch', () => {
      const unwatch = vfs.watch((e) => events.push(e));
      vfs.writeFile('/a.txt', 'first');
      unwatch();
      vfs.writeFile('/b.txt', 'second');
      expect(events.length).toBe(1);
    });
  });

  describe('onChange backward compat', () => {
    it('still calls onChange callback', () => {
      let called = false;
      vfs.onChange = () => { called = true; };
      vfs.writeFile('/file.txt', 'data');
      expect(called).toBe(true);
    });

    it('calls both onChange and watch listeners', () => {
      let onChangeCalled = false;
      vfs.onChange = () => { onChangeCalled = true; };
      vfs.watch((e) => events.push(e));
      vfs.writeFile('/file.txt', 'data');
      expect(onChangeCalled).toBe(true);
      expect(events.length).toBe(1);
    });
  });
});
