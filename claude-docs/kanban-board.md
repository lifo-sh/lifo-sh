# KanbanBoard Component — What We Built & How It Works

## Overview

`KanbanBoard` is a reactive Kanban board UI component that lives in `packages/ui`. It mirrors the `FileExplorer` pattern — a vanilla TypeScript class, no framework, driven entirely by files in the VFS. All state (tasks, assignments, activity logs) lives as JSON files in the virtual filesystem. Agents and humans interact with the board by reading and writing those files directly.

---

## Files Changed / Created

| File | What Changed |
|---|---|
| `packages/ui/src/KanbanBoard.ts` | New — main component (KanbanStore + KanbanBoard classes) |
| `packages/ui/src/index.ts` | Added KanbanBoard exports |
| `apps/vite-app/src/main.ts` | Added `bootBoard()` function, CODE_BOARD snippet, board entry in examples map |
| `apps/vite-app/index.html` | Added "Kanban Board" sidebar item + `out-board` output panel |

---

## VFS Layout

All board state lives here:

```
/home/user/.kanban/
├── board.json           ← board metadata & column config (auto-created on first boot)
└── tasks/
    ├── {uuid}.json      ← one file per task (MissionControlHQ schema)
    └── {uuid}.json
```

There is no database, no in-memory store that persists between renders. The VFS is the single source of truth.

---

## Task File Schema (MissionControlHQ compatible)

Each task is a standalone JSON file at `/home/user/.kanban/tasks/{id}.json`:

```json
{
  "id": "uuid-v4",
  "title": "Fix login bug",
  "description": "Markdown body here",
  "status": "in_progress",
  "priority": "high",
  "assignee": "bot-1",
  "assignee_type": "agent",
  "tags": ["auth", "bug"],
  "created_at": "2026-02-25T00:00:00.000Z",
  "updated_at": "2026-02-25T00:00:00.000Z",
  "deliverables": [],
  "activity": [
    {
      "type": "created",
      "message": "Task created",
      "by": "user",
      "timestamp": "2026-02-25T00:00:00.000Z"
    },
    {
      "type": "assigned",
      "message": "Assigned to Bot 1",
      "by": "user",
      "timestamp": "2026-02-25T00:00:00.000Z"
    }
  ]
}
```

**Status values (6 columns):** `inbox | assigned | in_progress | testing | review | done`

**Priority values:** `none | low | medium | high`

**Assignee type:** `human | agent | null`

---

## Architecture: Two Internal Classes

### KanbanStore (internal, not exported)

Handles all VFS reads and writes. The board component itself never calls `vfs` directly — it always goes through the store.

```
KanbanStore
├── init()           → creates /home/user/.kanban/ dirs and board.json if missing
├── loadAllTasks()   → vfs.readdir(tasks/) → reads each .json → returns KanbanTask[]
├── loadTask(id)     → vfs.readFileString(tasks/{id}.json) → returns KanbanTask
├── saveTask(task)   → vfs.writeFile(tasks/{id}.json, JSON)
├── createTask(...)  → crypto.randomUUID() + vfs.writeFile
├── moveTask(id, newStatus) → loadTask → update status + push activity → saveTask
└── deleteTask(id)   → vfs.unlink(tasks/{id}.json)
```

All VFS calls are **synchronous** (the VFS API is sync: `readFileString`, `writeFile`, `readdir`, `unlink`).

### KanbanBoard (exported)

The component class. Manages the DOM, drag-and-drop, detail panel, and VFS watch.

```
KanbanBoard
├── constructor(container, vfs, options)
│   ├── injects <style> into document.head
│   ├── creates .kb-root div inside container
│   ├── calls store.init()
│   ├── calls this.render()
│   └── sets up vfs.watch(root, () => this.render())
├── on(handler)   → subscribe to board events, returns unsubscribe fn
├── refresh()     → manual re-render
└── destroy()     → unwatch + remove DOM + remove style
```

---

## How Rendering Works

The board holds **zero task state**. Every render is a fresh read from the VFS:

```
render()
  └── store.loadAllTasks()         ← reads all .json files from VFS
        └── group by task.status
              └── build DOM columns
                    └── renderColumn() × 6
                          └── renderCard() × N per column
```

After every VFS write (drag, create, save, delete), the watcher fires and `render()` runs again from scratch. The board is always a live view of the files.

---

## The VFS Watcher

Set up once in the constructor:

```typescript
// packages/ui/src/KanbanBoard.ts — constructor
this.unwatch = this.vfs.watch(this.options.root, () => {
  if (!this._rendering) {
    this.render();
  }
});
```

**What it watches:** `/home/user/.kanban/` and everything under it.

**When it fires:** Any file created, modified, or deleted under that path — whether the change came from the UI, a bot, a shell command, or a direct VFS write.

**The `_rendering` flag:** Prevents re-entrant renders. When `render()` is already running and reading VFS files, we don't want the watcher to trigger another render mid-flight.

**Cleanup:** Stored in `this.unwatch` and called in `destroy()` to avoid memory leaks.

### When to use a VFS watcher (mental model)

Use a watcher when your UI is a **view over files** and those files can be written by **multiple independent actors** — humans, agents, shell commands, other components. Without a watcher you'd need to poll (wasteful) or manually re-render after every possible write path (brittle). The watcher fires immediately and only when something actually changes.

---

## Assignees — What's in VFS vs What's in Memory

This is an important distinction:

| Data | Where it lives |
|---|---|
| Which task is assigned to whom (`assignee: "bot-1"`) | **VFS** — inside each task's `.json` file |
| Assignee identity (name, type, avatar) | **Memory only** — passed as `options.assignees` at construction time |

```typescript
new KanbanBoard(container, vfs, {
  assignees: [
    { id: 'user',  name: 'You',     type: 'human' },
    { id: 'bot-1', name: 'Bot 1',   type: 'agent' },
    { id: 'bot-2', name: 'Planner', type: 'agent' },  // add more here
  ]
});
```

To add more assignees, extend the `assignees` array. The board uses the `id` field to look up names at render time. The `id` is what gets stored in the task file.

If you want assignees to be fully VFS-driven (so agents can register themselves at runtime), that would need a separate `/home/user/.kanban/assignees.json` file and a watch — not currently implemented.

---

## Agent / Bot Integration

Bots interact with the board by writing JSON files directly — no component API needed.

### Bot creates a task

```typescript
const task = {
  id: crypto.randomUUID(),
  title: 'Investigate memory leak',
  description: 'Heap growing unbounded in worker process.',
  status: 'inbox',
  priority: 'high',
  assignee: null,
  assignee_type: null,
  tags: ['perf'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deliverables: [],
  activity: [{ type: 'created', message: 'Task created by bot', by: 'bot-1', timestamp: new Date().toISOString() }],
};

vfs.writeFile('/home/user/.kanban/tasks/' + task.id + '.json', JSON.stringify(task, null, 2));
// Board re-renders instantly via vfs.watch()
```

### Bot moves a task to a new column

```typescript
const path = '/home/user/.kanban/tasks/abc123.json';
const task = JSON.parse(vfs.readFileString(path));

task.status = 'done';
task.updated_at = new Date().toISOString();
task.activity.push({
  type: 'status_changed',
  message: 'Moved from in_progress to done',
  by: 'bot-1',
  timestamp: new Date().toISOString(),
});

vfs.writeFile(path, JSON.stringify(task, null, 2));
```

### Bot assigns a task to another agent

```typescript
const path = '/home/user/.kanban/tasks/abc123.json';
const task = JSON.parse(vfs.readFileString(path));

task.assignee = 'bot-2';
task.assignee_type = 'agent';
task.activity.push({
  type: 'assigned',
  message: 'Reassigned to Planner',
  by: 'bot-1',
  timestamp: new Date().toISOString(),
});

vfs.writeFile(path, JSON.stringify(task, null, 2));
```

Using the async sandbox fs API (from outside, e.g. browser console):

```typescript
const content = await sandbox.fs.readFile('/home/user/.kanban/tasks/abc123.json');
const task = JSON.parse(content);
task.status = 'done';
await sandbox.fs.writeFile('/home/user/.kanban/tasks/abc123.json', JSON.stringify(task, null, 2));
```

---

## Component API

```typescript
class KanbanBoard {
  constructor(container: HTMLElement, vfs: VFS, options?: KanbanBoardOptions)
  on(handler: (event: KanbanBoardEvent) => void): () => void   // returns unsubscribe fn
  refresh(): void
  destroy(): void
}

interface KanbanBoardOptions {
  root?: string;              // VFS root (default: /home/user/.kanban)
  assignees?: KanbanAssignee[];
}

interface KanbanAssignee {
  id: string;
  name: string;
  type: 'human' | 'agent';
  avatar?: string;
}

type KanbanBoardEvent =
  | { type: 'card-moved';    taskId: string; from: KanbanStatus; to: KanbanStatus }
  | { type: 'card-created';  taskId: string }
  | { type: 'card-updated';  taskId: string }
  | { type: 'card-deleted';  taskId: string }
  | { type: 'card-assigned'; taskId: string; assignee: string | null };
```

---

## Drag and Drop

Uses the native HTML5 drag API — no library.

- Cards have `draggable="true"`
- Each column body listens for `dragover` and `drop`
- On drop: `store.moveTask(taskId, newStatus)` → writes to VFS → watcher fires → board re-renders
- The `_rendering` flag prevents a re-render from clearing a card mid-drag

---

## Seeded Example Tasks

`bootBoard()` in `main.ts` seeds 5 tasks spread across columns on first boot (only if the tasks directory is empty, so it won't overwrite state on reload):

| Column | Task |
|---|---|
| inbox | Set up CI pipeline |
| assigned | Design onboarding flow |
| in_progress | Implement Kanban VFS watch |
| testing | Write unit tests |
| done | Update README |

Since `persist: true` is set, these tasks survive page reloads via IndexedDB.

---

## Styling

Scoped CSS injected as a `<style>` tag in `document.head`. Tokyo Night color palette matching the rest of the app:

| Element | Color |
|---|---|
| Background | `#1a1b26` |
| Column bg | `#16161e` |
| Border | `#2f3146` |
| Text | `#a9b1d6` |
| Bright text | `#c0caf5` |
| Priority — high | `#f7768e` (red) |
| Priority — medium | `#ff9e64` (orange) |
| Priority — low | `#9ece6a` (green) |
| Priority — none | `#565f89` (muted) |
| Human badge | `#7aa2f7` (blue) |
| Agent badge | `#bb9af7` (purple) |
