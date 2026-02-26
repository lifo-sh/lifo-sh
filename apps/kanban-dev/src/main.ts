import { Kernel } from '@lifo-sh/core';
import { KanbanBoard } from '@lifo-sh/ui';
import { KanbanSync } from './sync.js';
import { RunnerControls } from './runner-controls.js';
import { LogPanel } from './log-panel.js';

async function boot() {
  // No IndexedDB — persist: false. State lives on disk via the server.
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  const vfs  = kernel.vfs;
  const root = '/home/user/.kanban';

  const sync = new KanbanSync(vfs, root);
  await sync.hydrate();    // load all tasks from server into VFS

  // Mount RunnerControls
  const runnerEl = document.getElementById('runner-controls')!;
  const runnerControls = new RunnerControls(runnerEl);

  // Mount LogPanel
  const logEl = document.getElementById('log-panel')!;
  const logPanel = new LogPanel(logEl);

  // Wire WS messages to RunnerControls + LogPanel
  sync.setRunnerStatusHandler((status) => {
    runnerControls.updateStatus(status as Parameters<typeof runnerControls.updateStatus>[0]);
  });

  sync.setAgentActivityHandler((activity) => {
    const a = activity as { agent: string; action: string; message: string; timestamp: string };
    logPanel.addLog({
      level: a.action === 'error' ? 'error' : 'info',
      source: a.agent,
      message: a.message,
      timestamp: a.timestamp,
    });
  });

  sync.setServerLogHandler((log) => {
    logPanel.addLog(log);
  });

  sync.connect();          // open WebSocket for live updates
  sync.startWatching();    // mirror VFS writes back to server

  new KanbanBoard(document.getElementById('board')!, vfs, {
    root,
    assignees: [
      { id: 'user',     name: 'You',        type: 'human' },
      { id: 'planning', name: 'Planning',   type: 'agent' },
      { id: 'progress', name: 'Progress',   type: 'agent' },
      { id: 'testing',  name: 'Testing',    type: 'agent' },
      { id: 'review',   name: 'Review',     type: 'agent' },
      { id: 'completion', name: 'Completion', type: 'agent' },
    ],
  });
}

boot().catch(console.error);
