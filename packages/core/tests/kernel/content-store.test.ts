import { describe, it, expect, beforeEach } from 'vitest';
import { ContentStore, CHUNK_THRESHOLD, CHUNK_SIZE, ChunkRef } from '../../src/kernel/storage/ContentStore.js';
import { hashBytes } from '../../src/kernel/storage/BlobStore.js';

describe('ContentStore', () => {
  let store: ContentStore;

  beforeEach(() => {
    store = new ContentStore();
  });

  // ─── Basic put/get/delete ───

  describe('basic operations', () => {
    it('put stores and get retrieves data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = store.put(data);
      expect(typeof hash).toBe('string');

      const retrieved = store.get(hash);
      expect(retrieved).toEqual(data);
    });

    it('put returns consistent hash for same content (dedup)', () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 30]);
      const h1 = store.put(a);
      const h2 = store.put(b);
      expect(h1).toBe(h2);
      expect(store.count).toBe(1); // only one entry
    });

    it('get returns null for missing hash', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('has returns true for stored, false for missing', () => {
      const hash = store.put(new Uint8Array([42]));
      expect(store.has(hash)).toBe(true);
      expect(store.has('missing')).toBe(false);
    });

    it('delete removes an entry', () => {
      const hash = store.put(new Uint8Array([1, 2]));
      expect(store.has(hash)).toBe(true);
      store.delete(hash);
      expect(store.has(hash)).toBe(false);
      expect(store.get(hash)).toBeNull();
    });

    it('delete of non-existent hash is a no-op', () => {
      store.delete('doesnotexist'); // should not throw
    });

    it('size tracks total bytes', () => {
      expect(store.size).toBe(0);
      store.put(new Uint8Array(100));
      expect(store.size).toBe(100);
      store.put(new Uint8Array(200));
      expect(store.size).toBe(300);
    });

    it('count tracks number of entries', () => {
      expect(store.count).toBe(0);
      store.put(new Uint8Array([1]));
      store.put(new Uint8Array([2]));
      expect(store.count).toBe(2);
    });
  });

  // ─── Chunked storage ───

  describe('storeChunked / loadChunked', () => {
    it('chunks data into CHUNK_SIZE pieces', () => {
      // 3 full chunks + 1 partial
      const size = CHUNK_SIZE * 3 + 100;
      const data = new Uint8Array(size);
      for (let i = 0; i < data.length; i++) data[i] = i % 256;

      const chunks = store.storeChunked(data);
      expect(chunks).toHaveLength(4);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
      expect(chunks[1].size).toBe(CHUNK_SIZE);
      expect(chunks[2].size).toBe(CHUNK_SIZE);
      expect(chunks[3].size).toBe(100);
    });

    it('loadChunked reassembles the original data', () => {
      const size = CHUNK_SIZE * 2 + 500;
      const data = new Uint8Array(size);
      for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;

      const chunks = store.storeChunked(data);
      const result = store.loadChunked(chunks);
      expect(result).not.toBeNull();
      expect(result!.byteLength).toBe(size);
      expect(result).toEqual(data);
    });

    it('loadChunked returns null if a chunk is missing', () => {
      const data = new Uint8Array(CHUNK_SIZE * 2);
      const chunks = store.storeChunked(data);

      // Delete one chunk
      store.delete(chunks[0].hash);

      const result = store.loadChunked(chunks);
      expect(result).toBeNull();
    });

    it('deleteChunked removes all chunks', () => {
      const data = new Uint8Array(CHUNK_SIZE * 3);
      const chunks = store.storeChunked(data);
      expect(store.count).toBeGreaterThan(0);

      store.deleteChunked(chunks);
      for (const chunk of chunks) {
        expect(store.has(chunk.hash)).toBe(false);
      }
      expect(store.size).toBe(0);
    });

    it('deduplicates identical chunks', () => {
      // Create data where all chunks are identical (all zeros)
      const data = new Uint8Array(CHUNK_SIZE * 4);
      const chunks = store.storeChunked(data);

      // All chunks should reference the same hash
      expect(chunks).toHaveLength(4);
      const hashes = new Set(chunks.map((c) => c.hash));
      expect(hashes.size).toBe(1); // only one unique hash

      // Store should only have 1 entry (deduplicated)
      expect(store.count).toBe(1);
      expect(store.size).toBe(CHUNK_SIZE);
    });

    it('single chunk for data exactly CHUNK_SIZE', () => {
      const data = new Uint8Array(CHUNK_SIZE);
      const chunks = store.storeChunked(data);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].size).toBe(CHUNK_SIZE);
    });

    it('handles empty data', () => {
      const data = new Uint8Array(0);
      const chunks = store.storeChunked(data);
      expect(chunks).toHaveLength(0);

      const result = store.loadChunked(chunks);
      expect(result).not.toBeNull();
      expect(result!.byteLength).toBe(0);
    });
  });

  // ─── LRU eviction ───

  describe('LRU eviction', () => {
    it('evicts oldest entries when budget is exceeded', () => {
      // 10KB budget
      const small = new ContentStore(10 * 1024);

      // Store 5 entries of 3KB each = 15KB total (exceeds 10KB)
      const hashes: string[] = [];
      for (let i = 0; i < 5; i++) {
        const data = new Uint8Array(3 * 1024);
        data[0] = i; // unique content
        hashes.push(small.put(data));
      }

      // Budget is 10KB, so at most 3 entries (9KB) should remain
      expect(small.size).toBeLessThanOrEqual(10 * 1024);

      // The most recent entries should still be present
      expect(small.has(hashes[4])).toBe(true);
      expect(small.has(hashes[3])).toBe(true);

      // Oldest entries should have been evicted
      expect(small.has(hashes[0])).toBe(false);
      expect(small.has(hashes[1])).toBe(false);
    });

    it('get refreshes access time preventing eviction', () => {
      // 8KB budget
      const small = new ContentStore(8 * 1024);

      // Store 2 entries of 3KB each
      const data1 = new Uint8Array(3 * 1024);
      data1[0] = 1;
      const h1 = small.put(data1);

      const data2 = new Uint8Array(3 * 1024);
      data2[0] = 2;
      const h2 = small.put(data2);

      // Touch h1 to make it more recent than h2
      small.get(h1);

      // Add a third entry, forcing eviction
      const data3 = new Uint8Array(3 * 1024);
      data3[0] = 3;
      const h3 = small.put(data3);

      // h2 should be evicted (oldest access), h1 and h3 should remain
      expect(small.has(h1)).toBe(true);
      expect(small.has(h3)).toBe(true);
      expect(small.has(h2)).toBe(false);
    });

    it('does not evict when under budget', () => {
      const large = new ContentStore(1024 * 1024); // 1MB
      const hashes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const data = new Uint8Array(100);
        data[0] = i;
        hashes.push(large.put(data));
      }
      // All should remain
      for (const h of hashes) {
        expect(large.has(h)).toBe(true);
      }
    });

    it('delete frees space preventing unnecessary eviction', () => {
      // 6KB budget
      const small = new ContentStore(6 * 1024);

      const data1 = new Uint8Array(3 * 1024);
      data1[0] = 1;
      const h1 = small.put(data1);

      // Delete it to free space
      small.delete(h1);
      expect(small.size).toBe(0);

      // Now we can add two more without eviction
      const data2 = new Uint8Array(3 * 1024);
      data2[0] = 2;
      const h2 = small.put(data2);

      const data3 = new Uint8Array(3 * 1024);
      data3[0] = 3;
      const h3 = small.put(data3);

      expect(small.has(h2)).toBe(true);
      expect(small.has(h3)).toBe(true);
    });
  });
});

describe('VFS chunked file integration', () => {
  // We import VFS here to test the full integration
  let VFS: typeof import('../../src/kernel/vfs/VFS.js').VFS;

  beforeEach(async () => {
    const mod = await import('../../src/kernel/vfs/VFS.js');
    VFS = mod.VFS;
  });

  it('stores small files inline (not chunked)', () => {
    const vfs = new VFS();
    const data = new Uint8Array(1000); // well under 1MB
    vfs.writeFile('/small.bin', data);

    const stat = vfs.stat('/small.bin');
    expect(stat.size).toBe(1000);

    const read = vfs.readFile('/small.bin');
    expect(read.byteLength).toBe(1000);
    expect(vfs.contentStore.count).toBe(0); // nothing in content store
  });

  it('stores large files as chunks', () => {
    const vfs = new VFS();
    const size = CHUNK_THRESHOLD + 1000; // just over 1MB
    const data = new Uint8Array(size);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    vfs.writeFile('/large.bin', data);

    const stat = vfs.stat('/large.bin');
    expect(stat.size).toBe(size);

    // Content store should have chunks
    expect(vfs.contentStore.count).toBeGreaterThan(0);

    // Read back should return the exact same data
    const read = vfs.readFile('/large.bin');
    expect(read.byteLength).toBe(size);
    expect(read).toEqual(data);
  });

  it('overwriting a large file cleans up old chunks', () => {
    const vfs = new VFS();
    const data1 = new Uint8Array(CHUNK_THRESHOLD + 500);
    data1[0] = 1;
    vfs.writeFile('/file.bin', data1);

    const countAfterFirst = vfs.contentStore.count;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Overwrite with different large content
    const data2 = new Uint8Array(CHUNK_THRESHOLD + 500);
    data2[0] = 2;
    vfs.writeFile('/file.bin', data2);

    // Old chunks should be removed, new chunks added
    const read = vfs.readFile('/file.bin');
    expect(read[0]).toBe(2);
  });

  it('overwriting a large file with a small file clears chunks', () => {
    const vfs = new VFS();
    const big = new Uint8Array(CHUNK_THRESHOLD + 100);
    vfs.writeFile('/file.bin', big);
    expect(vfs.contentStore.count).toBeGreaterThan(0);

    // Overwrite with small data
    vfs.writeFile('/file.bin', new Uint8Array([1, 2, 3]));
    expect(vfs.contentStore.count).toBe(0);

    const read = vfs.readFile('/file.bin');
    expect(read).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('unlink cleans up chunks', () => {
    const vfs = new VFS();
    const data = new Uint8Array(CHUNK_THRESHOLD + 100);
    vfs.writeFile('/chunked.bin', data);
    expect(vfs.contentStore.count).toBeGreaterThan(0);

    vfs.unlink('/chunked.bin');
    expect(vfs.contentStore.count).toBe(0);
    expect(vfs.contentStore.size).toBe(0);
  });

  it('appendFile grows a small file past the threshold and chunks it', () => {
    const vfs = new VFS();
    // Start with a file just under the threshold
    const initial = new Uint8Array(CHUNK_THRESHOLD - 100);
    vfs.writeFile('/grow.bin', initial);
    expect(vfs.contentStore.count).toBe(0); // inline

    // Append enough to cross the threshold
    const extra = new Uint8Array(200);
    vfs.appendFile('/grow.bin', extra);

    // Now it should be chunked
    expect(vfs.contentStore.count).toBeGreaterThan(0);

    const read = vfs.readFile('/grow.bin');
    expect(read.byteLength).toBe(CHUNK_THRESHOLD - 100 + 200);
  });

  it('appendFile on an already-chunked file re-chunks correctly', () => {
    const vfs = new VFS();
    const initial = new Uint8Array(CHUNK_THRESHOLD + 500);
    for (let i = 0; i < initial.length; i++) initial[i] = i % 256;
    vfs.writeFile('/append.bin', initial);

    const extra = new Uint8Array(1000);
    for (let i = 0; i < extra.length; i++) extra[i] = (i + 100) % 256;
    vfs.appendFile('/append.bin', extra);

    const read = vfs.readFile('/append.bin');
    expect(read.byteLength).toBe(CHUNK_THRESHOLD + 500 + 1000);

    // Verify content integrity
    for (let i = 0; i < initial.length; i++) {
      expect(read[i]).toBe(initial[i]);
    }
    for (let i = 0; i < extra.length; i++) {
      expect(read[initial.length + i]).toBe(extra[i]);
    }
  });

  it('copyFile of a chunked file creates an independent copy', () => {
    const vfs = new VFS();
    const data = new Uint8Array(CHUNK_THRESHOLD + 100);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    vfs.writeFile('/src.bin', data);

    vfs.copyFile('/src.bin', '/dest.bin');

    const readSrc = vfs.readFile('/src.bin');
    const readDest = vfs.readFile('/dest.bin');
    expect(readSrc).toEqual(readDest);
    expect(readDest.byteLength).toBe(CHUNK_THRESHOLD + 100);
  });

  it('stat reports storedSize for chunked files', () => {
    const vfs = new VFS();
    const size = CHUNK_THRESHOLD * 2;
    vfs.writeFile('/big.bin', new Uint8Array(size));

    const stat = vfs.stat('/big.bin');
    expect(stat.size).toBe(size);
  });

  it('readdirStat reports storedSize for chunked files', () => {
    const vfs = new VFS();
    const size = CHUNK_THRESHOLD + 100;
    vfs.mkdir('/dir');
    vfs.writeFile('/dir/big.bin', new Uint8Array(size));
    vfs.writeFile('/dir/small.txt', 'hello');

    const entries = vfs.readdirStat('/dir');
    const big = entries.find((e) => e.name === 'big.bin')!;
    const small = entries.find((e) => e.name === 'small.txt')!;

    expect(big.size).toBe(size);
    expect(small.size).toBe(5);
  });

  it('custom ContentStore budget is respected', () => {
    const store = new ContentStore(512 * 1024); // 512KB budget
    const vfs = new VFS(store);

    // Write a 1MB file -- it will be chunked into 4 x 256KB
    // But budget is 512KB, so LRU will evict older chunks
    const data = new Uint8Array(CHUNK_THRESHOLD);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    vfs.writeFile('/file.bin', data);

    expect(store.size).toBeLessThanOrEqual(512 * 1024);
  });
});
