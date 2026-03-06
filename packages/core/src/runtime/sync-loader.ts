/**
 * Main-thread file loader — SharedArrayBuffer + Atomics protocol.
 *
 * When the execution worker calls require(), it blocks via Atomics.wait().
 * This loader receives the path request through a MessagePort, reads the
 * file from the VFS synchronously, writes the result into the shared
 * buffer, then wakes the worker with Atomics.notify().
 *
 * Requires Cross-Origin Isolation (COOP + COEP headers) so the browser
 * permits SharedArrayBuffer. Add to your server / vite config:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * SharedArrayBuffer layout
 * ────────────────────────
 * Int32 view
 *   [0]  status   0 = idle | 1 = response ready
 *   [1]  length   byte-length of content, or -1 (not found), -2 (too large)
 * Uint8 view (byte offset 8)
 *   [8…] UTF-8 encoded file content
 */

import type { VFS } from '../kernel/vfs/index.js';

export const SAB_SIZE = 16 * 1024 * 1024; // 16 MB — max supported file size
const STATUS_READY = 1;
const HEADER_BYTES = 8; // 2 × Int32

export interface SyncLoader {
  dispose(): void;
}

export function createSyncLoader(port: MessagePort, sab: SharedArrayBuffer, vfs: VFS): SyncLoader {
  const int32 = new Int32Array(sab);
  const uint8 = new Uint8Array(sab);
  const encoder = new TextEncoder();

  const handleRequest = (event: MessageEvent<{ path: string }>): void => {
    let content: string | null = null;
    try {
      content = vfs.exists(event.data.path) ? vfs.readFileString(event.data.path) : null;
    } catch {
      content = null;
    }

    if (content === null) {
      Atomics.store(int32, 1, -1); // not found
    } else {
      const bytes = encoder.encode(content);
      if (HEADER_BYTES + bytes.byteLength > sab.byteLength) {
        Atomics.store(int32, 1, -2); // file too large
      } else {
        uint8.set(bytes, HEADER_BYTES);
        Atomics.store(int32, 1, bytes.byteLength);
      }
    }

    // Signal worker: response is ready
    Atomics.store(int32, 0, STATUS_READY);
    Atomics.notify(int32, 0);
  };

  port.addEventListener('message', handleRequest as EventListener);
  port.start(); // required when using addEventListener (not onmessage)

  return {
    dispose() {
      port.removeEventListener('message', handleRequest as EventListener);
      port.close();
    },
  };
}
