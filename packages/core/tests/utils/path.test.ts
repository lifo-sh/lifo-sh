import { describe, it, expect } from 'vitest';
import { resolve, join, dirname, basename, extname, normalize, isAbsolute, split } from '../../src/utils/path.js';

describe('normalize', () => {
  it('handles root', () => expect(normalize('/')).toBe('/'));
  it('handles empty', () => expect(normalize('')).toBe('.'));
  it('removes trailing slash', () => expect(normalize('/foo/')).toBe('/foo'));
  it('collapses double slashes', () => expect(normalize('/foo//bar')).toBe('/foo/bar'));
  it('resolves dots', () => expect(normalize('/foo/./bar')).toBe('/foo/bar'));
  it('resolves double dots', () => expect(normalize('/foo/bar/../baz')).toBe('/foo/baz'));
  it('clamps at root', () => expect(normalize('/foo/../../bar')).toBe('/bar'));
  it('relative dot', () => expect(normalize('.')).toBe('.'));
  it('relative double dots', () => expect(normalize('foo/../bar')).toBe('bar'));
  it('relative with leading double dots', () => expect(normalize('../foo')).toBe('../foo'));
});

describe('isAbsolute', () => {
  it('detects absolute', () => expect(isAbsolute('/foo')).toBe(true));
  it('detects relative', () => expect(isAbsolute('foo')).toBe(false));
});

describe('join', () => {
  it('joins segments', () => expect(join('foo', 'bar')).toBe('foo/bar'));
  it('normalizes result', () => expect(join('/foo', '../bar')).toBe('/bar'));
  it('handles absolute in middle', () => expect(join('foo', '/bar')).toBe('foo/bar'));
});

describe('resolve', () => {
  it('resolves relative to cwd', () => expect(resolve('/home', 'foo')).toBe('/home/foo'));
  it('absolute overrides cwd', () => expect(resolve('/home', '/etc')).toBe('/etc'));
  it('resolves multiple segments', () => expect(resolve('/home', 'user', 'docs')).toBe('/home/user/docs'));
  it('handles ..', () => expect(resolve('/home/user', '..')).toBe('/home'));
});

describe('dirname', () => {
  it('returns parent', () => expect(dirname('/foo/bar')).toBe('/foo'));
  it('returns root for top-level', () => expect(dirname('/foo')).toBe('/'));
  it('handles relative', () => expect(dirname('foo/bar')).toBe('foo'));
  it('returns dot for bare name', () => expect(dirname('foo')).toBe('.'));
});

describe('basename', () => {
  it('returns last component', () => expect(basename('/foo/bar.txt')).toBe('bar.txt'));
  it('strips extension', () => expect(basename('/foo/bar.txt', '.txt')).toBe('bar'));
  it('handles root', () => expect(basename('/')).toBe(''));
});

describe('extname', () => {
  it('returns extension', () => expect(extname('file.txt')).toBe('.txt'));
  it('returns last extension', () => expect(extname('file.tar.gz')).toBe('.gz'));
  it('returns empty for no extension', () => expect(extname('file')).toBe(''));
  it('returns empty for dotfile', () => expect(extname('.gitignore')).toBe(''));
});

describe('split', () => {
  it('splits absolute path', () => expect(split('/foo/bar')).toEqual(['/', 'foo', 'bar']));
  it('splits relative path', () => expect(split('foo/bar')).toEqual(['foo', 'bar']));
  it('handles root', () => expect(split('/')).toEqual(['/']));
});
