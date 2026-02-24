import type { SerializedNode } from './serializer.js';

// ---------------------------------------------------------------------------
// PersistenceBackend interface
// ---------------------------------------------------------------------------

export interface PersistenceBackend {
  open(): Promise<void>;
  loadTree(): Promise<SerializedNode | null>;
  saveTree(root: SerializedNode): Promise<void>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// IndexedDBPersistenceBackend
// ---------------------------------------------------------------------------

const DB_NAME = 'lifo';
const STORE_NAME = 'filesystem';
const KEY = 'root';

export class IndexedDBPersistenceBackend implements PersistenceBackend {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;

    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => {
        console.warn('IndexedDB not available, persistence disabled');
        resolve();
      };
    });
  }

  async loadTree(): Promise<SerializedNode | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(KEY);

        request.onsuccess = () => {
          if (request.result) {
            resolve(request.result as SerializedNode);
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

  async saveTree(root: SerializedNode): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(root, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ---------------------------------------------------------------------------
// MemoryPersistenceBackend
// ---------------------------------------------------------------------------

export class MemoryPersistenceBackend implements PersistenceBackend {
  private tree: SerializedNode | null = null;

  async open(): Promise<void> {
    // Nothing to initialize for in-memory storage.
  }

  async loadTree(): Promise<SerializedNode | null> {
    return this.tree;
  }

  async saveTree(root: SerializedNode): Promise<void> {
    this.tree = root;
  }

  async close(): Promise<void> {
    this.tree = null;
  }
}
