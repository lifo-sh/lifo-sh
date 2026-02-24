import type { INode } from '../vfs/types.js';
import { serialize, deserialize } from './serializer.js';
import type { PersistenceBackend } from './backends.js';

const DEBOUNCE_MS = 1000;

export class PersistenceManager {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private backend: PersistenceBackend) {}

  async open(): Promise<void> {
    await this.backend.open();
  }

  async load(): Promise<INode | null> {
    try {
      const data = await this.backend.loadTree();
      if (data) {
        try {
          return deserialize(data);
        } catch {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async save(root: INode): Promise<void> {
    try {
      const data = serialize(root);
      await this.backend.saveTree(data);
    } catch {
      // Gracefully ignore save errors
    }
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
