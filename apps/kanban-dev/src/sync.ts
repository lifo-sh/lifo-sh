import type { VFS } from '@lifo-sh/core';

export class KanbanSync {
  private vfs: VFS;
  private root: string;
  private ws: WebSocket | null = null;
  // IDs we just sent to the server — suppress the echo WS event
  private pendingSync = new Set<string>();

  constructor(vfs: VFS, root: string) {
    this.vfs = vfs;
    this.root = root;
  }

  // Fetch all tasks from server → write into VFS
  async hydrate(): Promise<void> {
    const tasks: unknown[] = await fetch('/api/tasks').then(r => r.json());

    try { this.vfs.mkdir(this.root, { recursive: true }); } catch { /* exists */ }
    try { this.vfs.mkdir(this.root + '/tasks', { recursive: true }); } catch { /* exists */ }

    for (const task of tasks) {
      const t = task as { id: string };
      this.vfs.writeFile(
        this.root + '/tasks/' + t.id + '.json',
        JSON.stringify(task, null, 2),
      );
    }
  }

  // Open WebSocket — apply server-push changes to local VFS
  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);

    this.ws.addEventListener('message', evt => {
      const msg = JSON.parse(evt.data as string) as {
        type: string; id: string; content?: string;
      };

      if (this.pendingSync.has(msg.id)) {
        this.pendingSync.delete(msg.id);
        return; // echo from our own write — skip
      }

      if (msg.type === 'task-updated' && msg.content) {
        this.vfs.writeFile(this.root + '/tasks/' + msg.id + '.json', msg.content);
      } else if (msg.type === 'task-deleted') {
        try { this.vfs.unlink(this.root + '/tasks/' + msg.id + '.json'); } catch { /* gone */ }
      }
    });
  }

  // Watch VFS for board-initiated writes → forward to server
  startWatching(): void {
    this.vfs.watch(this.root + '/tasks', event => {
      const name = event.path.split('/').pop();
      if (!name?.endsWith('.json')) return;
      const id = name.replace('.json', '');

      if (event.type === 'delete') {
        this.pendingSync.add(id);
        fetch('/api/tasks/' + id, { method: 'DELETE' }).catch(console.error);
        return;
      }

      try {
        const content = this.vfs.readFileString(this.root + '/tasks/' + name);
        this.pendingSync.add(id);
        fetch('/api/tasks/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: content,
        }).catch(console.error);
      } catch { /* file gone */ }
    });
  }

  destroy(): void {
    this.ws?.close();
  }
}
