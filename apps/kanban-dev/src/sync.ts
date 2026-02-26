import type { VFS } from '@lifo-sh/core';

export type RunnerStatusHandler = (status: unknown) => void;
export type AgentActivityHandler = (activity: unknown) => void;
export type ServerLogHandler = (log: { level: string; source: string; message: string; meta?: Record<string, unknown>; timestamp: string }) => void;

export class KanbanSync {
  private vfs: VFS;
  private root: string;
  private ws: WebSocket | null = null;
  // IDs we just sent to the server — suppress the echo WS event
  private pendingSync = new Set<string>();
  private onRunnerStatus: RunnerStatusHandler | null = null;
  private onAgentActivity: AgentActivityHandler | null = null;
  private onServerLog: ServerLogHandler | null = null;

  constructor(vfs: VFS, root: string) {
    this.vfs = vfs;
    this.root = root;
  }

  setRunnerStatusHandler(handler: RunnerStatusHandler): void {
    this.onRunnerStatus = handler;
  }

  setAgentActivityHandler(handler: AgentActivityHandler): void {
    this.onAgentActivity = handler;
  }

  setServerLogHandler(handler: ServerLogHandler): void {
    this.onServerLog = handler;
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
        type: string; id?: string; content?: string;
      };

      // Handle runner-status messages
      if (msg.type === 'runner-status') {
        this.onRunnerStatus?.(msg);
        return;
      }

      // Handle agent-activity messages
      if (msg.type === 'agent-activity') {
        this.onAgentActivity?.(msg);
        return;
      }

      // Handle server-log messages
      if (msg.type === 'server-log') {
        this.onServerLog?.(msg as unknown as Parameters<ServerLogHandler>[0]);
        return;
      }

      if (msg.id && this.pendingSync.has(msg.id)) {
        this.pendingSync.delete(msg.id);
        return; // echo from our own write — skip
      }

      if (msg.type === 'task-updated' && msg.content && msg.id) {
        this.vfs.writeFile(this.root + '/tasks/' + msg.id + '.json', msg.content);
      } else if (msg.type === 'task-deleted' && msg.id) {
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
