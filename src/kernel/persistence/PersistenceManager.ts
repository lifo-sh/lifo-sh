import type { INode } from '../vfs/types.js';
import { serialize, deserialize, type SerializedNode } from './serializer.js';

const DB_NAME = 'browseros';
const STORE_NAME = 'filesystem';
const KEY = 'root';
const DEBOUNCE_MS = 1000;

export class PersistenceManager {
  private db: IDBDatabase | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

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
        // Gracefully degrade if IndexedDB fails
        console.warn('IndexedDB not available, persistence disabled');
        resolve();
      };
    });
  }

  async load(): Promise<INode | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(KEY);

        request.onsuccess = () => {
          if (request.result) {
            try {
              const root = deserialize(request.result as SerializedNode);
              resolve(root);
            } catch {
              resolve(null);
            }
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

  async save(root: INode): Promise<void> {
    if (!this.db) return;

    const data = serialize(root);

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(data, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  scheduleSave(root: INode): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.save(root).catch(() => {});
      this.timer = null;
    }, DEBOUNCE_MS);
  }
}
