import { describe, it, expect } from 'vitest';
import path, { relative, parse, format, sep, delimiter } from '../../src/node-compat/path.js';

describe('node-compat path', () => {
  it('join works', () => {
    expect(path.join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
    expect(path.join('/foo', '../bar')).toBe('/bar');
  });

  it('resolve works', () => {
    expect(path.resolve('/foo', 'bar')).toBe('/foo/bar');
    expect(path.resolve('/foo', '/bar')).toBe('/bar');
  });

  it('dirname works', () => {
    expect(path.dirname('/foo/bar/baz.txt')).toBe('/foo/bar');
    expect(path.dirname('/foo')).toBe('/');
  });

  it('basename works', () => {
    expect(path.basename('/foo/bar.txt')).toBe('bar.txt');
    expect(path.basename('/foo/bar.txt', '.txt')).toBe('bar');
  });

  it('extname works', () => {
    expect(path.extname('file.txt')).toBe('.txt');
    expect(path.extname('file')).toBe('');
    expect(path.extname('.hidden')).toBe('');
    expect(path.extname('file.tar.gz')).toBe('.gz');
  });

  it('relative computes correct relative path', () => {
    expect(relative('/foo/bar', '/foo/baz')).toBe('../baz');
    expect(relative('/foo/bar', '/foo/bar/baz')).toBe('baz');
    expect(relative('/foo/bar/baz', '/foo/bar')).toBe('..');
    expect(relative('/foo', '/foo')).toBe('.');
  });

  it('parse returns correct components', () => {
    const result = parse('/home/user/file.txt');
    expect(result.root).toBe('/');
    expect(result.dir).toBe('/home/user');
    expect(result.base).toBe('file.txt');
    expect(result.ext).toBe('.txt');
    expect(result.name).toBe('file');
  });

  it('format reconstructs path', () => {
    expect(format({ dir: '/home/user', base: 'file.txt' })).toBe('/home/user/file.txt');
    expect(format({ root: '/', name: 'file', ext: '.txt' })).toBe('/file.txt');
  });

  it('sep is /', () => {
    expect(sep).toBe('/');
  });

  it('delimiter is :', () => {
    expect(delimiter).toBe(':');
  });

  it('normalize works', () => {
    expect(path.normalize('/foo//bar/../baz')).toBe('/foo/baz');
  });

  it('isAbsolute works', () => {
    expect(path.isAbsolute('/foo')).toBe(true);
    expect(path.isAbsolute('foo')).toBe(false);
  });
});
