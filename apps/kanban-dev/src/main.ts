import { Kernel } from '@lifo-sh/core';
import { KanbanBoard } from '@lifo-sh/ui';
import { KanbanSync } from './sync.js';
import { RunnerControls } from './runner-controls.js';
import { LogPanel } from './log-panel.js';
import { TaskPanel } from './task-panel.js';

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

  // Mount TaskPanel (attached to body so it can overlay everything)
  const taskPanel = new TaskPanel(document.body, vfs, root);

  // ── Wire WS messages ──────────────────────────────────────────────────────

  sync.setRunnerStatusHandler((status) => {
    runnerControls.updateStatus(status as Parameters<typeof runnerControls.updateStatus>[0]);
  });

  sync.setAgentActivityHandler((activity) => {
    const a = activity as {
      taskId: string;
      agent: string;
      action: 'started' | 'completed' | 'error';
      message: string;
      timestamp: string;
    };

    // Pulse the card while agent is working
    const card = document.querySelector(`[data-task-id="${a.taskId}"]`) as HTMLElement | null;
    if (a.action === 'started') {
      card?.classList.add('agent-active');
      // Show active agent in runner controls
      let taskTitle = a.taskId.slice(0, 8) + '…';
      try {
        const raw = vfs.readFileString(`${root}/tasks/${a.taskId}.json`);
        taskTitle = (JSON.parse(raw) as { title: string }).title;
      } catch { /* ok */ }
      runnerControls.setActiveAgent({ agent: a.agent, taskTitle });
    } else {
      card?.classList.remove('agent-active');
      runnerControls.setActiveAgent(null);
      // Refresh panel if it's showing this task
      taskPanel.refreshIfShowing(a.taskId);
    }

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

  // ── KanbanBoard ───────────────────────────────────────────────────────────

  new KanbanBoard(document.getElementById('board')!, vfs, {
    root,
    assignees: [
      { id: 'user',       name: 'You',        type: 'human' },
      { id: 'planning',   name: 'Planning',   type: 'agent' },
      { id: 'progress',   name: 'Progress',   type: 'agent' },
      { id: 'testing',    name: 'Testing',    type: 'agent' },
      { id: 'review',     name: 'Review',     type: 'agent' },
      { id: 'completion', name: 'Completion', type: 'agent' },
    ],
  });

  // ── Intercept card clicks (capture phase → fires before KB's own handler) ─
  // Opens our TaskPanel instead of KB's built-in detail view.
  document.getElementById('board')!.addEventListener('click', (e) => {
    const cardEl = (e.target as HTMLElement).closest('[data-task-id]') as HTMLElement | null;
    if (!cardEl) return;
    e.stopPropagation();
    const taskId = cardEl.dataset.taskId!;
    taskPanel.showTask(taskId);
  }, true /* capture */);
}

boot().catch(console.error);
