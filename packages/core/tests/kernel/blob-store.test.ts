import { describe, it, expect, beforeEach } from 'vitest';
import { hashBytes, MemoryBlobStore } from '../../src/kernel/storage/BlobStore.js';

describe('hashBytes', () => {
  it('produces consistent hashes for same data', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hash1 = hashBytes(data);
    const hash2 = hashBytes(data);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different data', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    expect(hashBytes(a)).not.toBe(hashBytes(b));
  });

  it('returns a 16-character hex string', () => {
    const data = new Uint8Array([10, 20, 30]);
    const hash = hashBytes(data);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('MemoryBlobStore', () => {
  let store: MemoryBlobStore;

  beforeEach(() => {
    store = new MemoryBlobStore();
  });

  it('put returns a hash and get retrieves the same data', async () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const hash = await store.put(data);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(16);

    const retrieved = await store.get(hash);
    expect(retrieved).toBeInstanceOf(Uint8Array);
    expect(retrieved).toEqual(data);
  });

  it('has returns true for stored blobs and false for missing ones', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const hash = await store.put(data);

    expect(await store.has(hash)).toBe(true);
    expect(await store.has('0000000000000000')).toBe(false);
  });

  it('delete removes the blob', async () => {
    const data = new Uint8Array([9, 8, 7]);
    const hash = await store.put(data);

    expect(await store.has(hash)).toBe(true);
    await store.delete(hash);
    expect(await store.has(hash)).toBe(false);
    expect(await store.get(hash)).toBeNull();
  });

  it('get returns a copy so mutating the result does not affect the store', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const hash = await store.put(data);

    const result = await store.get(hash);
    expect(result).not.toBeNull();
    result![0] = 255;

    const fresh = await store.get(hash);
    expect(fresh![0]).toBe(10);
  });

  it('storing the same data twice returns the same hash (dedup)', async () => {
    const data1 = new Uint8Array([100, 200]);
    const data2 = new Uint8Array([100, 200]);
    const hash1 = await store.put(data1);
    const hash2 = await store.put(data2);
    expect(hash1).toBe(hash2);
  });
});
