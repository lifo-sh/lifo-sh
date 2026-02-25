# KanbanBoard Dev Environment — Implementation Plan

## What We're Building

A new standalone app (`apps/kanban-dev/`) that runs the KanbanBoard UI with a VFS backed by a **real filesystem** instead of IndexedDB. This is the server-side analog of the existing browser setup — when the board writes a task, it goes to actual `.json` files on disk via `NativeFsProvider`.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (Vite)                                      │
│  ┌──────────────┐   events    ┌─────────────────┐   │
│  │ KanbanBoard  │ ──────────▶ │  KanbanSync      │   │
│  │  (DOM + VFS) │ ◀──────────  (WS client + HTTP)│   │
│  └──────────────┘   vfs.write └────────┬────────┘   │
└───────────────────────────────────────┼─────────────┘
                                        │ HTTP REST + WebSocket
┌───────────────────────────────────────▼─────────────┐
│  Server (Node.js / tsx)                               │
│  ┌───────────────────────────────────────────────┐   │
│  │  VFS + NativeFsProvider → ./data/ on disk     │   │
│  │  Express REST API  /api/tasks                  │   │
│  │  WebSocket server  (broadcast changes)         │   │
│  │  chokidar watch    (external file changes)     │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### Write flow (user drags a card in the browser)

1. KanbanBoard writes task JSON to browser VFS → instant re-render
2. `KanbanSync` VFS watcher fires → HTTP PATCH to server
3. Server writes to `./data/tasks/{id}.json` via VFS + NativeFsProvider (real disk)
4. Server broadcasts WS event to other connected clients only

### External write flow (bot / agent writes file directly to disk)

1. Bot writes to `./data/tasks/{id}.json`
2. Server's `chokidar` watch fires → reads file → broadcasts WS event to all browsers
3. Browser `KanbanSync` receives event → writes to local VFS
4. VFS watcher → KanbanBoard re-renders

---

## File Structure

```
apps/kanban-dev/
├── package.json         ← new app package
├── tsconfig.json        ← extends root tsconfig
├── vite.config.ts       ← proxy /api + /ws to :3001
├── index.html           ← <div id="board"> entry point
├── server/
│   └── index.ts         ← Express + ws + VFS + NativeFsProvider
└── src/
    ├── main.ts          ← browser: VFS + KanbanBoard + KanbanSync boot
    └── sync.ts          ← KanbanSync class: WS client + REST sync
```

---

## File Contents

### `apps/kanban-dev/package.json`

```json
{
  "name": "kanban-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"tsx watch server/index.ts\" \"vite\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@lifo-sh/core": "workspace:*",
    "@lifo-sh/ui": "workspace:*",
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "chokidar": "^3.6.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/node": "^20.0.0",
    "concurrently": "^8.2.2",
    "tsx": "^4.7.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

---

### `apps/kanban-dev/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "server"]
}
```

---

### `apps/kanban-dev/vite.config.ts`

Proxies `/api` and `/ws` to the Node.js server during dev so the browser hits the same origin.

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
```

---

### `apps/kanban-dev/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kanban Dev</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #1a1b26; height: 100vh; overflow: hidden; }
      #board { width: 100%; height: 100vh; }
    </style>
  </head>
  <body>
    <div id="board"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

---

### `apps/kanban-dev/server/index.ts`

Key responsibilities:
- Creates `VFS` and mounts `NativeFsProvider` at `/kanban` → `./data/` on disk
- Ensures `./data/tasks/` directory exists on startup
- Express REST API for task CRUD
- WebSocket server for real-time push to browsers
- `chokidar` watches `./data/tasks/` for external changes (bots, agents, CLI)

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import { VFS, NativeFsProvider } from '@lifo-sh/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const TASKS_DIR = path.join(DATA_DIR, 'tasks');

// 1. Ensure data directories exist
fs.mkdirSync(TASKS_DIR, { recursive: true });

// 2. Create VFS with NativeFsProvider
//    vfs.writeFile('/kanban/tasks/foo.json', ...) → ./data/tasks/foo.json on disk
const vfs = new VFS();
vfs.mount('/kanban', new NativeFsProvider(DATA_DIR, fs));

// 3. Init board.json if missing
const boardPath = '/kanban/board.json';
if (!vfs.exists(boardPath)) {
  vfs.writeFile(boardPath, JSON.stringify({
    id: crypto.randomUUID(),
    name: 'My Board',
    columns: ['inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'],
    created_at: new Date().toISOString(),
  }, null, 2));
}

// 4. Express app
const app = express();
app.use(express.json());

// GET /api/tasks  — read all task JSON files
app.get('/api/tasks', (_req, res) => {
  const entries = vfs.readdir('/kanban/tasks');
  const tasks = entries
    .filter(e => e.type === 'file' && e.name.endsWith('.json'))
    .map(e => {
      try {
        return JSON.parse(vfs.readFileString('/kanban/tasks/' + e.name));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  res.json(tasks);
});

// POST /api/tasks  — create a new task
app.post('/api/tasks', (req, res) => {
  const task = req.body;
  vfs.writeFile('/kanban/tasks/' + task.id + '.json', JSON.stringify(task, null, 2));
  res.json(task);
});

// PUT /api/tasks/:id  — update a task
app.put('/api/tasks/:id', (req, res) => {
  const task = req.body;
  vfs.writeFile('/kanban/tasks/' + req.params.id + '.json', JSON.stringify(task, null, 2));
  res.json(task);
});

// DELETE /api/tasks/:id  — delete a task
app.delete('/api/tasks/:id', (req, res) => {
  try {
    vfs.unlink('/kanban/tasks/' + req.params.id + '.json');
  } catch { /* already gone */ }
  res.json({ ok: true });
});

// 5. HTTP server + WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: object, skip?: WebSocket) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== skip && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  ws.on('close', () => console.log('[ws] client disconnected'));
});

// 6. chokidar: watch for external writes (bots, agents, CLI)
//    When a file changes outside the REST API, broadcast to all browsers
const pendingApiWrites = new Set<string>();

export function markApiWrite(id: string) {
  pendingApiWrites.add(id);
  setTimeout(() => pendingApiWrites.delete(id), 500);
}

chokidar.watch(TASKS_DIR, { ignoreInitial: true }).on('all', (event, filePath) => {
  const name = path.basename(filePath);
  if (!name.endsWith('.json')) return;
  const id = name.replace('.json', '');

  if (pendingApiWrites.has(id)) return; // came from our own REST API, skip

  if (event === 'unlink') {
    broadcast({ type: 'task-deleted', id });
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    broadcast({ type: 'task-updated', id, content });
  } catch { /* file may have been deleted mid-read */ }
});

server.listen(3001, () => {
  console.log('[server] listening on http://localhost:3001');
  console.log('[data]   task files at', TASKS_DIR);
});
```

---

### `apps/kanban-dev/src/sync.ts`

`KanbanSync` mirrors the server's real filesystem into the browser's in-memory VFS and keeps them in sync.

```typescript
import type { VFS } from '@lifo-sh/core';

export class KanbanSync {
  private vfs: VFS;
  private root: string;
  private ws: WebSocket | null = null;
  // IDs currently being sent to server — suppress the echo WS event
  private pendingSync = new Set<string>();

  constructor(vfs: VFS, root: string) {
    this.vfs = vfs;
    this.root = root;
  }

  // On boot: fetch all tasks from server and write them into VFS
  async hydrate(): Promise<void> {
    const res = await fetch('/api/tasks');
    const tasks: unknown[] = await res.json();

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

  // Connect WebSocket and apply server-broadcast changes to local VFS
  connect(): void {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data as string) as {
        type: string;
        id: string;
        content?: string;
      };

      if (this.pendingSync.has(msg.id)) {
        this.pendingSync.delete(msg.id);
        return; // this change originated from us, skip
      }

      if (msg.type === 'task-updated' && msg.content) {
        this.vfs.writeFile(
          this.root + '/tasks/' + msg.id + '.json',
          msg.content,
        );
      } else if (msg.type === 'task-deleted') {
        try {
          this.vfs.unlink(this.root + '/tasks/' + msg.id + '.json');
        } catch { /* already gone */ }
      }
    });
  }

  // Watch the VFS for board-initiated writes → sync to server
  startWatching(): void {
    this.vfs.watch(this.root + '/tasks', (event) => {
      const name = event.path.split('/').pop();
      if (!name || !name.endsWith('.json')) return;
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
      } catch { /* file may have been deleted */ }
    });
  }

  destroy(): void {
    this.ws?.close();
  }
}
```

---

### `apps/kanban-dev/src/main.ts`

```typescript
import { Kernel } from '@lifo-sh/core';
import { KanbanBoard } from '@lifo-sh/ui';
import { KanbanSync } from './sync.js';

async function boot() {
  // In-memory VFS only — no IndexedDB. Disk is the source of truth.
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  const vfs = kernel.vfs;
  const root = '/home/user/.kanban';

  // Hydrate VFS from server, then connect WebSocket for live updates
  const sync = new KanbanSync(vfs, root);
  await sync.hydrate();
  sync.connect();
  sync.startWatching();

  // Mount the KanbanBoard — it sees a fully populated VFS and re-renders
  // on every VFS change, exactly as in the browser build
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
```

---

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **VFS stays in-memory in the browser** | VFS API is synchronous — can't make async HTTP calls inside `readFile()`. Browser VFS is a mirror, server VFS is the source of truth. |
| **NativeFsProvider on the server** | Wraps Node.js `fs` sync calls. `vfs.mount('/kanban', new NativeFsProvider('./data', fs))` means every VFS operation at `/kanban/*` directly hits disk. |
| **`persist: false` in browser** | No IndexedDB. State lives on the server disk, not in the browser. On reload, `hydrate()` re-fetches from server. |
| **KanbanBoard unchanged** | Reused as-is from `@lifo-sh/ui`. The component doesn't know or care whether its VFS is backed by IndexedDB, real disk, or a network mirror. |
| **chokidar for external changes** | `fs.watch()` is unreliable cross-platform. chokidar gives consistent file change events so bots/agents writing directly to `./data/tasks/` trigger browser re-renders. |
| **Echo suppression via `pendingSync`** | When the browser writes to VFS → sends to server → server would broadcast back. The `pendingSync` Set blocks applying this echo to avoid double-render. |

---

## Critical Files Referenced

| File | Purpose |
|------|---------|
| `packages/core/src/kernel/vfs/providers/NativeFsProvider.ts` | `MountProvider` wrapping Node.js `fs` — the core of "VFS → real disk" |
| `packages/core/src/kernel/vfs/VFS.ts` | `vfs.mount(path, provider)` — how NativeFsProvider is wired in |
| `packages/core/src/kernel/index.ts` | `Kernel` class — `boot({ persist: false })` skips IndexedDB |
| `packages/ui/src/KanbanBoard.ts` | Component reused unchanged |
| `apps/vite-app/src/main.ts` | Reference for `bootBoard()` seed data and wiring pattern |
| `packages/core/vite.config.ts` | Reference Vite config pattern for this monorepo |

---

## How to Run

```bash
# 1. From monorepo root
pnpm install

# 2. Start the dev environment
cd apps/kanban-dev
pnpm dev
# → server on localhost:3001  (Express + WS + real fs writes)
# → browser on localhost:5173 (Vite + KanbanBoard)
```

---

## Verifying It Works

1. Open `localhost:5173` → board loads with tasks read from `./data/tasks/*.json`
2. Drag a card → check that `./data/tasks/{id}.json` has the updated `status` field on disk
3. Create a new task → a new `.json` file appears in `./data/tasks/`
4. From a terminal: manually write/edit a file in `./data/tasks/` → board re-renders within ~200ms (chokidar fires)
5. Open two browser tabs → action in one tab propagates to the other via WebSocket
6. Kill and restart the server → all tasks are still there (they're files on disk)
