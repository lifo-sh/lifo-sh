import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import { VFS, NativeFsProvider } from '@lifo-sh/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../data');
const TASKS_DIR = path.join(DATA_DIR, 'tasks');

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
  const task = req.body as { id: string };
  const content = JSON.stringify(task, null, 2);
  pendingApiWrites.add(task.id);
  vfs.writeFile('/kanban/tasks/' + task.id + '.json', content);
  broadcast({ type: 'task-updated', id: task.id, content });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = req.body as { id: string };
  const content = JSON.stringify(task, null, 2);
  pendingApiWrites.add(req.params.id);
  vfs.writeFile('/kanban/tasks/' + req.params.id + '.json', content);
  broadcast({ type: 'task-updated', id: req.params.id, content });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  pendingApiWrites.add(req.params.id);
  try { vfs.unlink('/kanban/tasks/' + req.params.id + '.json'); } catch { /* already gone */ }
  broadcast({ type: 'task-deleted', id: req.params.id });
  res.json({ ok: true });
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

  if (event === 'unlink') {
    broadcast({ type: 'task-deleted', id });
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    broadcast({ type: 'task-updated', id, content });
  } catch { /* file deleted mid-read */ }
});

server.listen(3001, () => {
  console.log('[server] http://localhost:3001');
  console.log('[data]  ', TASKS_DIR);
});
