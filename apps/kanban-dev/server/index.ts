import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import { VFS, NativeFsProvider } from '@lifo-sh/core';

import { Runner } from './runner.js';
import type { QueueEntry } from './runner.js';
import type { AgentModule, KanbanTask } from './agents/types.js';

// Agent imports
import * as planningAgent from './agents/planning/index.js';
import * as progressAgent from './agents/progress/index.js';
import * as testingAgent from './agents/testing/index.js';
import * as reviewAgent from './agents/review/index.js';
import * as completionAgent from './agents/completion/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../data');
const TASKS_DIR = path.join(DATA_DIR, 'tasks');
const RUNNER_PATH = path.join(DATA_DIR, 'runner.json');

// Ensure data directories exist on disk
fs.mkdirSync(TASKS_DIR, { recursive: true });

// VFS backed by real disk.
// vfs.writeFile('/kanban/tasks/foo.json', ...) → ./data/tasks/foo.json
const vfs = new VFS();
vfs.mount('/kanban', new NativeFsProvider(DATA_DIR, fs));

// Init board.json if missing
if (!vfs.exists('/kanban/board.json')) {
  vfs.writeFile('/kanban/board.json', JSON.stringify({
    id: crypto.randomUUID(),
    name: 'My Board',
    columns: ['inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'],
    created_at: new Date().toISOString(),
  }, null, 2));
}

// ─── Agent Registry ─────────────────────────────────────────────────────────

const agents: AgentModule[] = [
  planningAgent,
  progressAgent,
  testingAgent,
  reviewAgent,
  completionAgent,
];

// Map: triggerStatus → agent module
const agentByTrigger = new Map<string, AgentModule>();
for (const agent of agents) {
  agentByTrigger.set(agent.config.triggerStatus, agent);
  console.log(`[agents] registered: ${agent.config.name} (triggers on "${agent.config.triggerStatus}")`);
}

function findAgentForStatus(status: string): AgentModule | undefined {
  return agentByTrigger.get(status);
}

// ─── Runner (control plane) ─────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === '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') {
  console.warn('[runner] ⚠ OPENROUTER_API_KEY not set — agents will fail. Set it in .env');
}

const runner = new Runner(RUNNER_PATH);

// Pipe runner logs to WS so the browser can see them
runner.setLogger((level, source, message, meta) => {
  broadcast({
    type: 'server-log',
    level,
    source,
    message,
    meta: meta || {},
    timestamp: new Date().toISOString(),
  });
});

// Track IDs currently being written by agents so chokidar doesn't re-trigger
const pendingAgentWrites = new Set<string>();

runner.setDispatcher(async (entry: QueueEntry) => {
  const agent = agentByTrigger.get(entry.toStatus);
  if (!agent) {
    console.error(`[dispatch] no agent for status "${entry.toStatus}"`);
    return;
  }

  // Broadcast agent-activity: started
  broadcast({
    type: 'agent-activity',
    taskId: entry.taskId,
    agent: agent.config.name,
    action: 'started',
    message: `${agent.config.name} agent started processing`,
    timestamp: new Date().toISOString(),
  });
  broadcast({
    type: 'server-log',
    level: 'info',
    source: agent.config.name,
    message: `agent started for task ${entry.taskId.slice(0, 8)}... (${entry.fromStatus} → ${entry.toStatus})`,
    meta: { taskId: entry.taskId },
    timestamp: new Date().toISOString(),
  });

  try {
    // Read fresh task data from disk
    const taskData = fs.readFileSync(entry.taskPath, 'utf8');
    const task: KanbanTask = JSON.parse(taskData);

    // ── Server-side loop enforcement ─────────────────────────────────────────
    // Check transition_count against pipeline.json maxTransitionsPerEdge.
    // This is enforced in code, not just in the LLM prompt.
    const pipelineConfig = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'pipeline.json'), 'utf8')
    ) as { maxTransitionsPerEdge: number };
    const edgeKey = `${entry.fromStatus}→${entry.toStatus}`;
    const transitionCount = task.transition_count?.[edgeKey] || 0;
    if (transitionCount >= pipelineConfig.maxTransitionsPerEdge) {
      broadcast({
        type: 'server-log',
        level: 'warn',
        source: 'dispatcher',
        message: `loop limit reached for task ${entry.taskId.slice(0, 8)}... on edge ${edgeKey} — forcing to done`,
        meta: { taskId: entry.taskId, edgeKey, transitionCount },
        timestamp: new Date().toISOString(),
      });
      task.status = 'done';
      task.activity.push({
        type: 'status_changed',
        message: `Loop limit reached (${transitionCount} transitions on ${edgeKey}) — forced to done`,
        by: 'dispatcher',
        timestamp: new Date().toISOString(),
      });
      task.updated_at = new Date().toISOString();
      fs.writeFileSync(entry.taskPath, JSON.stringify(task, null, 2));
      broadcast({ type: 'task-updated', id: entry.taskId, content: JSON.stringify(task, null, 2) });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Mark this task as being written by an agent (suppress chokidar echo)
    pendingAgentWrites.add(entry.taskId);

    await agent.handle(task, entry.taskPath, OPENROUTER_API_KEY);

    // Broadcast agent-activity: completed
    broadcast({
      type: 'agent-activity',
      taskId: entry.taskId,
      agent: agent.config.name,
      action: 'completed',
      message: `${agent.config.name} agent completed`,
      timestamp: new Date().toISOString(),
    });
    broadcast({
      type: 'server-log',
      level: 'info',
      source: agent.config.name,
      message: `agent completed for task ${entry.taskId.slice(0, 8)}...`,
      meta: { taskId: entry.taskId },
      timestamp: new Date().toISOString(),
    });

    // Read the updated task and broadcast it
    try {
      const updatedContent = fs.readFileSync(entry.taskPath, 'utf8');
      broadcast({ type: 'task-updated', id: entry.taskId, content: updatedContent });

      // Update status cache with the new status
      const updatedTask = JSON.parse(updatedContent) as KanbanTask;
      let newStatus = updatedTask.status;
      statusCache.set(entry.taskId, newStatus);

      // ── Custom pipeline redirect ──────────────────────────────────────────
      // If the task has a custom pipeline, ensure the next status follows it.
      // The agent may have moved to its hardcoded targetStatus — we override
      // that here if it falls outside the task's declared route.
      if (updatedTask.pipeline && updatedTask.pipeline.length > 0) {
        const currentIdx = updatedTask.pipeline.indexOf(entry.toStatus);
        const nextInPipeline = updatedTask.pipeline[currentIdx + 1];
        if (nextInPipeline && newStatus !== nextInPipeline) {
          broadcast({
            type: 'server-log',
            level: 'info',
            source: 'dispatcher',
            message: `pipeline redirect for task ${entry.taskId.slice(0, 8)}...: ${newStatus} → ${nextInPipeline}`,
            meta: { taskId: entry.taskId },
            timestamp: new Date().toISOString(),
          });
          updatedTask.status = nextInPipeline;
          updatedTask.activity.push({
            type: 'status_changed',
            message: `Custom pipeline: redirected from ${newStatus} → ${nextInPipeline}`,
            by: 'dispatcher',
            timestamp: new Date().toISOString(),
          });
          newStatus = nextInPipeline;
          statusCache.set(entry.taskId, newStatus);
          fs.writeFileSync(entry.taskPath, JSON.stringify(updatedTask, null, 2));
          broadcast({ type: 'task-updated', id: entry.taskId, content: JSON.stringify(updatedTask, null, 2) });
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Clear agent write flag after broadcast
      setTimeout(() => pendingAgentWrites.delete(entry.taskId), 500);

      // Check if the agent moved the task to a new status that triggers another agent
      if (newStatus !== entry.toStatus || (newStatus === 'done' && !updatedTask.metadata?.completion)) {
        const nextAgent = findAgentForStatus(newStatus);
        if (nextAgent) {
          // Don't re-trigger the same agent for the same status (avoid completion loop)
          if (newStatus === 'done' && updatedTask.metadata?.completion) return;

          runner.requestDispatch({
            taskId: entry.taskId,
            taskPath: entry.taskPath,
            fromStatus: entry.toStatus,
            toStatus: newStatus,
            agentName: nextAgent.config.name,
            queuedAt: new Date().toISOString(),
          });
        }
      }
    } catch { /* file may have been deleted */ }
  } catch (err) {
    // Clear agent write flag
    setTimeout(() => pendingAgentWrites.delete(entry.taskId), 500);

    // Broadcast agent-activity: error
    broadcast({
      type: 'agent-activity',
      taskId: entry.taskId,
      agent: agent.config.name,
      action: 'error',
      message: `${agent.config.name} agent error: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    });
    broadcast({
      type: 'server-log',
      level: 'error',
      source: agent.config.name,
      message: `agent error: ${err instanceof Error ? err.message : String(err)}`,
      meta: { taskId: entry.taskId },
      timestamp: new Date().toISOString(),
    });

    // Read and broadcast the task (it may have error activity written)
    try {
      const content = fs.readFileSync(entry.taskPath, 'utf8');
      broadcast({ type: 'task-updated', id: entry.taskId, content });
    } catch { /* ignore */ }
  }
});

// ─── Status Cache (for detecting status transitions) ────────────────────────

const statusCache = new Map<string, string>();

// Populate cache from existing task files
try {
  const entries = vfs.readdir('/kanban/tasks');
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.json')) {
      try {
        const task = JSON.parse(vfs.readFileString('/kanban/tasks/' + entry.name));
        statusCache.set(task.id, task.status);
      } catch { /* skip malformed */ }
    }
  }
  console.log(`[status-cache] loaded ${statusCache.size} tasks`);
} catch { /* no tasks dir yet */ }

// ─── Express REST API ───────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/api/tasks', (_req, res) => {
  const entries = vfs.readdir('/kanban/tasks');
  const tasks = entries
    .filter(e => e.type === 'file' && e.name.endsWith('.json'))
    .flatMap(e => {
      try { return [JSON.parse(vfs.readFileString('/kanban/tasks/' + e.name))]; }
      catch { return []; }
    });
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const task = req.body as { id: string; status?: string };
  const content = JSON.stringify(task, null, 2);
  pendingApiWrites.add(task.id);
  vfs.writeFile('/kanban/tasks/' + task.id + '.json', content);
  // Update status cache
  if (task.status) statusCache.set(task.id, task.status);
  broadcast({ type: 'task-updated', id: task.id, content });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = req.body as { id: string; status?: string };
  const id = req.params.id;
  const content = JSON.stringify(task, null, 2);

  // Detect status change from API writes (user drags card)
  const oldStatus = statusCache.get(id);
  pendingApiWrites.add(id);
  vfs.writeFile('/kanban/tasks/' + id + '.json', content);

  if (task.status) statusCache.set(id, task.status);
  broadcast({ type: 'task-updated', id, content });

  // If status changed, request agent dispatch
  if (oldStatus && task.status && oldStatus !== task.status) {
    broadcast({
      type: 'server-log',
      level: 'info',
      source: 'status-change',
      message: `task ${id.slice(0, 8)}... status: ${oldStatus} → ${task.status}`,
      meta: { taskId: id, from: oldStatus, to: task.status },
      timestamp: new Date().toISOString(),
    });
    const agent = findAgentForStatus(task.status);
    if (agent) {
      runner.requestDispatch({
        taskId: id,
        taskPath: path.join(TASKS_DIR, id + '.json'),
        fromStatus: oldStatus,
        toStatus: task.status,
        agentName: agent.config.name,
        queuedAt: new Date().toISOString(),
      });
    }
  }

  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = req.params.id;
  pendingApiWrites.add(id);
  try { vfs.unlink('/kanban/tasks/' + id + '.json'); } catch { /* already gone */ }
  statusCache.delete(id);
  broadcast({ type: 'task-deleted', id });
  res.json({ ok: true });
});

// ─── Runner API routes ──────────────────────────────────────────────────────

app.get('/api/runner/status', (_req, res) => {
  res.json(runner.getStatus());
});

app.post('/api/runner/start', (_req, res) => {
  const status = runner.start();
  broadcast({ type: 'runner-status', ...status });
  res.json(status);
});

app.post('/api/runner/pause', (_req, res) => {
  const status = runner.pause();
  broadcast({ type: 'runner-status', ...status });
  res.json(status);
});

app.post('/api/runner/stop', (_req, res) => {
  const status = runner.stop();
  broadcast({ type: 'runner-status', ...status });
  res.json(status);
});

app.post('/api/runner/step', (_req, res) => {
  const status = runner.step();
  broadcast({ type: 'runner-status', ...status });
  res.json(status);
});

app.delete('/api/runner/queue', (_req, res) => {
  runner.clearQueue();
  const status = runner.getStatus();
  broadcast({ type: 'runner-status', ...status });
  res.json(status);
});

// ─── HTTP + WebSocket server ────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: object, skip?: WebSocket) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== skip && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', ws => {
  console.log('[ws] client connected');
  // Send current runner status on connect
  ws.send(JSON.stringify({ type: 'runner-status', ...runner.getStatus() }));
  ws.on('close', () => console.log('[ws] client disconnected'));
});

// ─── chokidar: watch for external writes (bots, terminal, agents) ───────────

// Track IDs currently being written via REST so we don't echo them back
const pendingApiWrites = new Set<string>();

chokidar.watch(TASKS_DIR, { ignoreInitial: true }).on('all', (event, filePath) => {
  const name = path.basename(filePath);
  if (!name.endsWith('.json')) return;
  const id = name.replace('.json', '');

  if (pendingApiWrites.has(id)) {
    pendingApiWrites.delete(id);
    return; // came from our own REST API — don't echo back
  }

  if (pendingAgentWrites.has(id)) {
    // Agent write — don't broadcast (dispatcher already handled it)
    return;
  }

  if (event === 'unlink') {
    statusCache.delete(id);
    broadcast({ type: 'task-deleted', id });
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    broadcast({ type: 'task-updated', id, content });

    // Detect status change from external writes
    const task = JSON.parse(content) as KanbanTask;
    const oldStatus = statusCache.get(task.id);
    statusCache.set(task.id, task.status);

    if (oldStatus && oldStatus !== task.status) {
      const agent = findAgentForStatus(task.status);
      if (agent) {
        runner.requestDispatch({
          taskId: task.id,
          taskPath: filePath,
          fromStatus: oldStatus,
          toStatus: task.status,
          agentName: agent.config.name,
          queuedAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* file deleted mid-read or malformed JSON */ }
});

server.listen(3001, () => {
  console.log('[server] http://localhost:3001');
  console.log('[data]  ', TASKS_DIR);
  console.log('[runner]', runner.getStatus().mode);
  console.log('[agents]', agents.map(a => a.config.name).join(', '));
});
