// Content-addressable blob storage using FNV-1a hashing.
// No external dependencies.

// ---------------------------------------------------------------------------
// FNV-1a 64-bit hash
// ---------------------------------------------------------------------------

// FNV-1a 64-bit offset basis: 0xcbf29ce484222325
const FNV_OFFSET_HIGH = 0xcbf29ce4;
const FNV_OFFSET_LOW = 0x84222325;

// FNV-1a 64-bit prime: 0x00000100000001b3
const FNV_PRIME_LOW = 0x000001b3;
const FNV_PRIME_HIGH_BYTE = 0x01; // the 0x100 component that lands in the high word

/**
 * Compute a 64-bit FNV-1a hash of the given bytes and return it as a
 * 16-character lowercase hex string.
 *
 * We split the 64-bit state into two 32-bit halves (high, low) and apply
 * the FNV-1a algorithm byte-by-byte: xor then multiply by the prime.
 */
export function hashBytes(data: Uint8Array): string {
  let high = FNV_OFFSET_HIGH;
  let low = FNV_OFFSET_LOW;

  for (let i = 0; i < data.length; i++) {
    // XOR the byte into the low 32 bits of the hash state
    low ^= data[i];

    // Multiply the 64-bit state by the 64-bit prime 0x00000100_000001b3.
    //
    // The prime has two non-zero components:
    //   - 0x000001b3 in the low word
    //   - 0x100 that shifts the old low word into the high word
    //
    // Full product (only lower 64 bits kept):
    //   new_low  = (low * 0x1b3) & 0xFFFFFFFF
    //   new_high = (high * 0x1b3) + (low * 0x100) + carry_from_low_multiply

    // Split low into 16-bit halves for precise integer multiplication.
    const a = low & 0xFFFF;
    const b = (low >>> 16) & 0xFFFF;

    const aTimesPrime = a * FNV_PRIME_LOW;
    const bTimesPrime = b * FNV_PRIME_LOW;

    const newLowLo = aTimesPrime & 0xFFFF;
    const mid = (aTimesPrime >>> 16) + (bTimesPrime & 0xFFFF);
    const newLowHi = mid & 0xFFFF;
    const carry = (mid >>> 16) + (bTimesPrime >>> 16);

    const newLow = ((newLowHi << 16) | newLowLo) >>> 0;

    // high word contribution:
    //   high * prime_low   (only lower 32 bits matter)
    // + low  * 0x100       (the prime's high component shifts low into high)
    // + carry              (from the low multiplication above)
    const newHigh =
      ((Math.imul(high, FNV_PRIME_LOW) + Math.imul(low, FNV_PRIME_HIGH_BYTE << 8) + carry) |
        0) >>>
      0;

    low = newLow;
    high = newHigh;
  }

  const highHex = high.toString(16).padStart(8, '0');
  const lowHex = low.toString(16).padStart(8, '0');
  return highHex + lowHex;
}

// ---------------------------------------------------------------------------
// BlobStore interface
// ---------------------------------------------------------------------------

export interface BlobStore {
  get(hash: string): Promise<Uint8Array | null>;
  put(data: Uint8Array): Promise<string>;
  delete(hash: string): Promise<void>;
  has(hash: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// MemoryBlobStore
// ---------------------------------------------------------------------------

export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, Uint8Array>();

  async get(hash: string): Promise<Uint8Array | null> {
    const data = this.blobs.get(hash);
    if (!data) return null;
    // Return a copy so callers cannot mutate internal state.
    return new Uint8Array(data);
  }

  async put(data: Uint8Array): Promise<string> {
    const hash = hashBytes(data);
    if (!this.blobs.has(hash)) {
      // Store a copy so the caller cannot mutate what we hold.
      this.blobs.set(hash, new Uint8Array(data));
    }
    return hash;
  }

  async delete(hash: string): Promise<void> {
    this.blobs.delete(hash);
  }

  async has(hash: string): Promise<boolean> {
    return this.blobs.has(hash);
  }
}

// ---------------------------------------------------------------------------
// IndexedDBBlobStore
// ---------------------------------------------------------------------------

const IDB_NAME = 'lifo-blobs';
const IDB_STORE = 'blobs';

export class IndexedDBBlobStore implements BlobStore {
  private db: IDBDatabase | null = null;

  /** Open (or create) the IndexedDB database. Call before using other methods. */
  async open(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;

    return new Promise((resolve) => {
      const request = indexedDB.open(IDB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        console.warn('IndexedDB not available for BlobStore');
        resolve();
      };
    });
  }

  async get(hash: string): Promise<Uint8Array | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const request = store.get(hash);

        request.onsuccess = () => {
          if (request.result) {
            resolve(new Uint8Array(request.result as ArrayBuffer));
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(data: Uint8Array): Promise<string> {
    const hash = hashBytes(data);

    if (!this.db) return hash;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        // Store the underlying ArrayBuffer for clean IDB serialization.
        store.put(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          hash,
        );

        tx.oncomplete = () => resolve(hash);
        tx.onerror = () => resolve(hash);
      } catch {
        resolve(hash);
      }
    });
  }

  async delete(hash: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.delete(hash);

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async has(hash: string): Promise<boolean> {
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const request = store.get(hash);

        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
