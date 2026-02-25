# Lifo Workspace + Jira Board + Bots — Architecture & API Guide

## Overview

This document covers three things:
1. How to boot a Lifo Workspace (Sandbox)
2. How to build a Jira-like board UI driven by the VFS
3. How to make bots read/write to the workspace and update the UI

---

## 1. Booting a Lifo Workspace

### What is a Workspace?

A **Sandbox** is an isolated, self-contained virtual Linux-like environment. It bundles:
- **Virtual Filesystem (VFS)** — in-memory + IndexedDB persistence
- **Shell** — bash-like interpreter with pipes, expansions, job control
- **Command Registry** — map of command names to async functions
- **Environment** — `HOME`, `USER`, `PATH`, etc.
- **Port Registry** — for HTTP servers running in Node.js mode

### Creating a Sandbox

```typescript
import { Sandbox } from '@lifo-sh/core';

// Headless (no UI — for bots / programmatic use)
const sandbox = await Sandbox.create({
  persist: true,           // files survive page reload via IndexedDB
  files: {
    '/home/user/tasks/todo/.keep': '',
    '/home/user/tasks/in-progress/.keep': '',
    '/home/user/tasks/done/.keep': '',
  }
});
```

### SandboxOptions

```typescript
interface SandboxOptions {
  persist?: boolean;                               // IndexedDB persistence (default: false)
  env?: Record<string, string>;                   // Extra env vars
  cwd?: string;                                   // Initial working directory (default: /home/user)
  files?: Record<string, string | Uint8Array>;    // Pre-seed files: path → content
  terminal?: string | HTMLElement | ITerminal;    // Attach to DOM element for interactive shell
  mounts?: Array<{
    virtualPath: string;     // Path inside VFS (e.g. "/mnt/host")
    hostPath: string;        // Real host filesystem path
    readOnly?: boolean;
  }>;
}
```

### Sandbox Public API

```typescript
class Sandbox {
  readonly commands: SandboxCommands;       // Run commands programmatically
  readonly fs: SandboxFs;                   // Filesystem operations
  readonly env: Record<string, string>;     // Environment variables
  readonly kernel: Kernel;                  // Low-level kernel access
  readonly shell: Shell;                    // Low-level shell access

  get cwd(): string;
  set cwd(path: string);

  mountNative(virtualPath: string, hostPath: string, options?: { readOnly?: boolean }): void;
  unmountNative(virtualPath: string): void;

  async attach(container: HTMLElement): Promise<void>;  // Attach terminal UI later
  detach(): void;

  async exportSnapshot(): Promise<Uint8Array>;           // Export VFS as tar.gz
  async importSnapshot(data: Uint8Array): Promise<void>; // Restore VFS from tar.gz

  destroy(): void;
}
```

---

## 2. The VFS — Filesystem API

### SandboxFs (High-level async API)

```typescript
// Read
await sandbox.fs.readFile('/home/user/tasks/todo/fix-bug.md');          // → string
await sandbox.fs.readFile('/home/user/tasks/todo/fix-bug.md', null);    // → Uint8Array
await sandbox.fs.readdir('/home/user/tasks/todo');                       // → [{ name, type }]
await sandbox.fs.stat('/home/user/tasks/todo/fix-bug.md');              // → { type, size, mtime }
await sandbox.fs.exists('/home/user/tasks/todo/fix-bug.md');            // → boolean

// Write
await sandbox.fs.writeFile('/home/user/tasks/todo/new-task.md', '# New Task');
await sandbox.fs.mkdir('/home/user/tasks/todo', { recursive: true });
await sandbox.fs.rename('/home/user/tasks/todo/task.md', '/home/user/tasks/done/task.md');
await sandbox.fs.rm('/home/user/tasks/todo/old-task.md', { recursive: true });
await sandbox.fs.cp('/home/user/template.md', '/home/user/tasks/todo/task.md');
```

### VFS Watch — Live Change Events (Key for Reactive UI)

```typescript
// Watch a specific directory
const unwatch = sandbox.kernel.vfs.watch('/home/user/tasks', (event) => {
  console.log(event.type);    // 'create' | 'modify' | 'delete' | 'rename'
  console.log(event.path);    // full path of the changed file
  console.log(event.fileType); // 'file' | 'directory'
  // event.oldPath — only on 'rename' events

  refreshBoard(); // re-render your UI here
});

// Stop watching
unwatch();
```

### VFS Watch Event Shape

```typescript
interface VFSWatchEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  oldPath?: string;   // only on rename
  fileType: 'file' | 'directory';
}
```

---

## 3. Running Commands Programmatically

### SandboxCommands

```typescript
interface SandboxCommands {
  run(cmd: string, options?: RunOptions): Promise<CommandResult>;
  register(name: string, handler: Command): void;
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  stdin?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;   // 0 = success
}
```

### Examples

```typescript
// Run a shell command
const result = await sandbox.commands.run('ls /home/user/tasks/todo');
console.log(result.stdout);

// Write a file via shell
await sandbox.commands.run(`echo '{"title":"Fix bug"}' > /home/user/tasks/todo/fix-bug.md`);

// Move a task (simulates dragging a card between columns)
await sandbox.commands.run('mv /home/user/tasks/todo/fix-bug.md /home/user/tasks/done/');

// Register a custom command for bots to call
sandbox.commands.register('move-task', async (ctx) => {
  const [taskName, fromCol, toCol] = ctx.args;
  ctx.vfs.rename(
    `/home/user/tasks/${fromCol}/${taskName}`,
    `/home/user/tasks/${toCol}/${taskName}`
  );
  ctx.stdout.write(`Moved ${taskName} → ${toCol}\n`);
  return 0; // exit code
});

// Bot calls the custom command
await sandbox.commands.run('move-task fix-bug.md todo done');
```

---

## 4. Jira-like Board Architecture

### File Structure Convention

Map Jira columns to VFS directories:

```
/home/user/tasks/
├── todo/
│   ├── fix-login-bug.md
│   └── add-dark-mode.md
├── in-progress/
│   └── refactor-auth.md
└── done/
    └── update-readme.md
```

Each `.md` file = one card. The file content holds the card's data (title, description, assignee, etc.).

### Task File Format (example)

```markdown
---
title: Fix login bug
assignee: bot-1
priority: high
created: 2026-02-25
---

## Description
The login form crashes when...

## Notes
- Checked auth flow
- Issue is in token refresh
```

### Board Initialization

```typescript
const COLUMNS = ['todo', 'in-progress', 'done'];
const TASKS_ROOT = '/home/user/tasks';

// Boot workspace
const sandbox = await Sandbox.create({ persist: true });

// Ensure column directories exist
for (const col of COLUMNS) {
  await sandbox.fs.mkdir(`${TASKS_ROOT}/${col}`, { recursive: true });
}

// Read all cards for initial render
async function loadBoard() {
  const board: Record<string, string[]> = {};
  for (const col of COLUMNS) {
    const entries = await sandbox.fs.readdir(`${TASKS_ROOT}/${col}`);
    board[col] = entries
      .filter(e => e.type === 'file' && e.name.endsWith('.md'))
      .map(e => e.name);
  }
  return board;
}

// Watch for live changes → re-render board
sandbox.kernel.vfs.watch(TASKS_ROOT, async (event) => {
  const newBoard = await loadBoard();
  renderBoard(newBoard);
});
```

---

## 5. Making Bots Read/Write to the Workspace

### Bot via Direct VFS API (fastest)

```typescript
async function botMoveTask(taskFile: string, fromCol: string, toCol: string) {
  await sandbox.fs.rename(
    `/home/user/tasks/${fromCol}/${taskFile}`,
    `/home/user/tasks/${toCol}/${taskFile}`
  );
  // VFS watch fires → board re-renders automatically
}

async function botCreateTask(col: string, filename: string, content: string) {
  await sandbox.fs.writeFile(`/home/user/tasks/${col}/${filename}`, content);
}

async function botReadTask(col: string, filename: string) {
  return await sandbox.fs.readFile(`/home/user/tasks/${col}/${filename}`);
}
```

### Bot via Shell Commands (flexible)

```typescript
// Bot uses the shell to operate on the filesystem
await sandbox.commands.run(`mv /home/user/tasks/todo/task.md /home/user/tasks/in-progress/`);
await sandbox.commands.run(`cat /home/user/tasks/todo/task.md`);
await sandbox.commands.run(`grep -r "priority: high" /home/user/tasks/todo/`);
```

### Bot as a Registered Custom Command

```typescript
// Register an AI-agent-aware command
sandbox.commands.register('bot-process', async (ctx) => {
  // ctx.vfs = full VFS access
  // ctx.stdout = write output
  // ctx.args = parsed arguments

  const tasks = ctx.vfs.readdir('/home/user/tasks/todo');
  for (const task of tasks) {
    if (task.type !== 'file') continue;
    const content = ctx.vfs.readFileString(`/home/user/tasks/todo/${task.name}`);
    // process the task with AI...
    ctx.vfs.rename(
      `/home/user/tasks/todo/${task.name}`,
      `/home/user/tasks/in-progress/${task.name}`
    );
    ctx.stdout.write(`Picked up: ${task.name}\n`);
  }
  return 0;
});

// Trigger the bot
await sandbox.commands.run('bot-process');
```

---

## 6. Full System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Jira-like Board UI                       │
│                                                           │
│  ┌─────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  TODO   │   │  IN PROGRESS │   │      DONE        │  │
│  │ card.md │   │   card.md    │   │    card.md       │  │
│  └─────────┘   └──────────────┘   └──────────────────┘  │
└───────────────────────┬──────────────────────────────────┘
                        │
              vfs.watch() triggers re-render
                        │
┌───────────────────────▼──────────────────────────────────┐
│                  Lifo Sandbox (VFS)                       │
│                                                           │
│   /home/user/tasks/todo/                                  │
│   /home/user/tasks/in-progress/                          │
│   /home/user/tasks/done/                                  │
│                                                           │
└──────────┬───────────────────────────┬────────────────────┘
           │                           │
    sandbox.fs.*                sandbox.commands.run()
    (direct VFS)                (shell commands)
           │                           │
┌──────────▼──────────┐   ┌───────────▼──────────────────┐
│    Bot Agent(s)     │   │   Interactive Shell Terminal  │
│  (AI / scripts)     │   │   (user types commands)       │
└─────────────────────┘   └──────────────────────────────┘
```

---

## 7. Key Files in This Codebase

| File | Purpose |
|---|---|
| `packages/core/src/sandbox/Sandbox.ts` | Main Sandbox class — boot, attach, destroy |
| `packages/core/src/sandbox/SandboxFs.ts` | Async VFS wrapper (readFile, writeFile, etc.) |
| `packages/core/src/sandbox/SandboxCommands.ts` | Run shell commands programmatically |
| `packages/core/src/kernel/vfs/VFS.ts` | Core VFS with watch API |
| `packages/core/src/index.ts` | All public exports |
| `apps/vite-app/src/main.ts` | 11 usage examples — read this first |

---

## 8. Implementation Checklist

- [ ] Boot a `Sandbox` with `persist: true` and pre-seed task directories
- [ ] Define task file format (frontmatter YAML + markdown body)
- [ ] Build board UI: read columns via `sandbox.fs.readdir()`
- [ ] Set up `vfs.watch()` on tasks root to re-render on any change
- [ ] Implement drag-drop: call `sandbox.fs.rename()` to move card between columns
- [ ] Write bot logic: read tasks, process, write back via `sandbox.fs`
- [ ] Optionally register bots as custom shell commands via `sandbox.commands.register()`
- [ ] Wire bot triggers (interval, event, user button, AI API response)
