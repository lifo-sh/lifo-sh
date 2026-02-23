import { describe, it, expect } from 'vitest';
import { crc32, createTar, parseTar, createZip, parseZip } from '../../src/utils/archive.js';
import { encode } from '../../src/utils/encoding.js';

describe('crc32', () => {
  it('produces correct checksum for empty data', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('produces correct checksum for known input', () => {
    const data = encode('hello');
    const result = crc32(data);
    expect(result).toBe(0x3610a686);
  });

  it('produces different checksums for different data', () => {
    const a = crc32(encode('foo'));
    const b = crc32(encode('bar'));
    expect(a).not.toBe(b);
  });
});

describe('tar', () => {
  it('round-trips a single file', () => {
    const data = encode('hello world');
    const entries = [{ path: 'test.txt', data, type: 'file' as const, mode: 0o644, mtime: Date.now() }];

    const tarData = createTar(entries);
    const parsed = parseTar(tarData);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe('test.txt');
    expect(parsed[0].type).toBe('file');
    expect(new TextDecoder().decode(parsed[0].data)).toBe('hello world');
  });

  it('round-trips multiple files and directories', () => {
    const entries = [
      { path: 'dir', data: new Uint8Array(0), type: 'directory' as const, mode: 0o755, mtime: Date.now() },
      { path: 'dir/a.txt', data: encode('aaa'), type: 'file' as const, mode: 0o644, mtime: Date.now() },
      { path: 'dir/b.txt', data: encode('bbb'), type: 'file' as const, mode: 0o644, mtime: Date.now() },
    ];

    const tarData = createTar(entries);
    const parsed = parseTar(tarData);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].path).toBe('dir');
    expect(parsed[0].type).toBe('directory');
    expect(parsed[1].path).toBe('dir/a.txt');
    expect(new TextDecoder().decode(parsed[1].data)).toBe('aaa');
    expect(parsed[2].path).toBe('dir/b.txt');
  });

  it('handles empty file', () => {
    const entries = [{ path: 'empty.txt', data: new Uint8Array(0), type: 'file' as const, mode: 0o644, mtime: Date.now() }];
    const tarData = createTar(entries);
    const parsed = parseTar(tarData);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].data.length).toBe(0);
  });

  it('handles binary data', () => {
    const data = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const entries = [{ path: 'binary.bin', data, type: 'file' as const, mode: 0o644, mtime: Date.now() }];

    const tarData = createTar(entries);
    const parsed = parseTar(tarData);

    expect(parsed[0].data).toEqual(data);
  });

  it('strips leading slash from paths', () => {
    const entries = [{ path: '/root/file.txt', data: encode('x'), type: 'file' as const, mode: 0o644, mtime: Date.now() }];
    const tarData = createTar(entries);
    const parsed = parseTar(tarData);

    expect(parsed[0].path).toBe('root/file.txt');
  });
});

describe('zip', () => {
  it('round-trips a single file', () => {
    const data = encode('hello zip');
    const entries = [{ path: 'test.txt', data, isDirectory: false }];

    const zipData = createZip(entries);
    const parsed = parseZip(zipData);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe('test.txt');
    expect(parsed[0].isDirectory).toBe(false);
    expect(new TextDecoder().decode(parsed[0].data)).toBe('hello zip');
  });

  it('round-trips multiple files', () => {
    const entries = [
      { path: 'a.txt', data: encode('aaa'), isDirectory: false },
      { path: 'b.txt', data: encode('bbb'), isDirectory: false },
    ];

    const zipData = createZip(entries);
    const parsed = parseZip(zipData);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].path).toBe('a.txt');
    expect(parsed[1].path).toBe('b.txt');
  });

  it('handles directories', () => {
    const entries = [
      { path: 'mydir', data: new Uint8Array(0), isDirectory: true },
      { path: 'mydir/file.txt', data: encode('content'), isDirectory: false },
    ];

    const zipData = createZip(entries);
    const parsed = parseZip(zipData);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].path).toBe('mydir');
    expect(parsed[0].isDirectory).toBe(true);
    expect(parsed[1].path).toBe('mydir/file.txt');
    expect(parsed[1].isDirectory).toBe(false);
  });

  it('throws on invalid zip', () => {
    expect(() => parseZip(new Uint8Array(10))).toThrow('Invalid ZIP');
  });
});
