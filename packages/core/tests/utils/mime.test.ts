import { describe, it, expect } from 'vitest';
import { getMimeType, getFileCategory, isBinaryMime } from '../../src/utils/mime.js';

describe('getMimeType', () => {
  it('returns text/javascript for .js', () => {
    expect(getMimeType('app.js')).toBe('text/javascript');
  });

  it('returns image/png for .png', () => {
    expect(getMimeType('photo.png')).toBe('image/png');
  });

  it('returns video/mp4 for .mp4', () => {
    expect(getMimeType('clip.mp4')).toBe('video/mp4');
  });

  it('returns application/zip for .zip', () => {
    expect(getMimeType('archive.zip')).toBe('application/zip');
  });

  it('returns application/pdf for .pdf', () => {
    expect(getMimeType('document.pdf')).toBe('application/pdf');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getMimeType('data.xyz123')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for files with no extension', () => {
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });
});

describe('getFileCategory', () => {
  it('returns text for text/* MIME types', () => {
    expect(getFileCategory('text/plain')).toBe('text');
    expect(getFileCategory('text/javascript')).toBe('text');
    expect(getFileCategory('text/html')).toBe('text');
  });

  it('returns image for image/* MIME types', () => {
    expect(getFileCategory('image/png')).toBe('image');
    expect(getFileCategory('image/jpeg')).toBe('image');
  });

  it('returns video for video/* MIME types', () => {
    expect(getFileCategory('video/mp4')).toBe('video');
    expect(getFileCategory('video/webm')).toBe('video');
  });

  it('returns audio for audio/* MIME types', () => {
    expect(getFileCategory('audio/mpeg')).toBe('audio');
    expect(getFileCategory('audio/wav')).toBe('audio');
  });

  it('returns archive for archive MIME types', () => {
    expect(getFileCategory('application/zip')).toBe('archive');
    expect(getFileCategory('application/x-tar')).toBe('archive');
    expect(getFileCategory('application/gzip')).toBe('archive');
    expect(getFileCategory('application/x-bzip2')).toBe('archive');
    expect(getFileCategory('application/x-7z-compressed')).toBe('archive');
    expect(getFileCategory('application/vnd.rar')).toBe('archive');
  });

  it('returns binary for other MIME types', () => {
    expect(getFileCategory('application/pdf')).toBe('binary');
    expect(getFileCategory('application/wasm')).toBe('binary');
    expect(getFileCategory('application/octet-stream')).toBe('binary');
  });

  it('treats application/json as text', () => {
    expect(getFileCategory('application/json')).toBe('text');
  });
});

describe('isBinaryMime', () => {
  it('returns false for text MIME types', () => {
    expect(isBinaryMime('text/plain')).toBe(false);
    expect(isBinaryMime('text/javascript')).toBe(false);
    expect(isBinaryMime('text/html')).toBe(false);
  });

  it('returns false for application/json', () => {
    expect(isBinaryMime('application/json')).toBe(false);
  });

  it('returns true for image MIME types', () => {
    expect(isBinaryMime('image/png')).toBe(true);
  });

  it('returns true for video MIME types', () => {
    expect(isBinaryMime('video/mp4')).toBe(true);
  });

  it('returns true for audio MIME types', () => {
    expect(isBinaryMime('audio/mpeg')).toBe(true);
  });

  it('returns true for archive MIME types', () => {
    expect(isBinaryMime('application/zip')).toBe(true);
  });

  it('returns true for binary application types', () => {
    expect(isBinaryMime('application/pdf')).toBe(true);
    expect(isBinaryMime('application/octet-stream')).toBe(true);
  });
});
