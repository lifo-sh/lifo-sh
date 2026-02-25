import { Kernel } from '@lifo-sh/core';
import { KanbanBoard } from '@lifo-sh/ui';
import { KanbanSync } from './sync.js';

async function boot() {
  // No IndexedDB — persist: false. State lives on disk via the server.
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  const vfs  = kernel.vfs;
  const root = '/home/user/.kanban';

  const sync = new KanbanSync(vfs, root);
  await sync.hydrate();    // load all tasks from server into VFS
  sync.connect();          // open WebSocket for live updates
  sync.startWatching();    // mirror VFS writes back to server

  new KanbanBoard(document.getElementById('board')!, vfs, {
    root,
    assignees: [
      { id: 'user',  name: 'You',     type: 'human' },
      { id: 'bot-1', name: 'Bot 1',   type: 'agent' },
      { id: 'bot-2', name: 'Planner', type: 'agent' },
    ],
  });
}

boot().catch(console.error);
