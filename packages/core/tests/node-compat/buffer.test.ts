import { describe, it, expect } from 'vitest';
import { Buffer } from '../../src/node-compat/buffer.js';

describe('Buffer', () => {
  it('Buffer.from(string) encodes to UTF-8', () => {
    const buf = Buffer.from('hello');
    expect(buf.length).toBe(5);
    expect(buf[0]).toBe(104); // 'h'
    expect(buf[4]).toBe(111); // 'o'
  });

  it('toString() decodes correctly', () => {
    const buf = Buffer.from('hello world');
    expect(buf.toString()).toBe('hello world');
  });

  it('Buffer.alloc(size) creates zeroed buffer', () => {
    const buf = Buffer.alloc(10);
    expect(buf.length).toBe(10);
    for (let i = 0; i < 10; i++) expect(buf[i]).toBe(0);
  });

  it('Buffer.alloc with fill', () => {
    const buf = Buffer.alloc(5, 0xab);
    for (let i = 0; i < 5; i++) expect(buf[i]).toBe(0xab);
  });

  it('Buffer.concat merges buffers', () => {
    const a = Buffer.from('hel');
    const b = Buffer.from('lo');
    const result = Buffer.concat([a, b]);
    expect(result.toString()).toBe('hello');
    expect(result.length).toBe(5);
  });

  it('Buffer.isBuffer returns true for Buffer instances', () => {
    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array(1))).toBe(false);
    expect(Buffer.isBuffer('string')).toBe(false);
  });

  it('from Uint8Array', () => {
    const arr = new Uint8Array([65, 66, 67]);
    const buf = Buffer.from(arr);
    expect(buf.toString()).toBe('ABC');
  });

  it('from number array', () => {
    const buf = Buffer.from([72, 105]);
    expect(buf.toString()).toBe('Hi');
  });

  it('hex encoding', () => {
    const buf = Buffer.from('hello');
    const hex = buf.toString('hex');
    expect(hex).toBe('68656c6c6f');

    const buf2 = Buffer.from(hex, 'hex');
    expect(buf2.toString()).toBe('hello');
  });

  it('base64 encoding', () => {
    const buf = Buffer.from('hello');
    const b64 = buf.toString('base64');
    expect(b64).toBe('aGVsbG8=');

    const buf2 = Buffer.from(b64, 'base64');
    expect(buf2.toString()).toBe('hello');
  });

  it('toJSON', () => {
    const buf = Buffer.from([1, 2, 3]);
    const json = buf.toJSON();
    expect(json.type).toBe('Buffer');
    expect(json.data).toEqual([1, 2, 3]);
  });

  it('equals', () => {
    const a = Buffer.from('abc');
    const b = Buffer.from('abc');
    const c = Buffer.from('xyz');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('write method', () => {
    const buf = Buffer.alloc(10);
    buf.write('Hi');
    expect(buf[0]).toBe(72);
    expect(buf[1]).toBe(105);
  });

  it('slice returns Buffer', () => {
    const buf = Buffer.from('hello');
    const sliced = buf.slice(1, 3);
    expect(Buffer.isBuffer(sliced)).toBe(true);
    expect(sliced.toString()).toBe('el');
  });
});
