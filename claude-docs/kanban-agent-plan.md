# AI Kanban Agent System — Implementation Plan

---

## First Principles

### 1. The filesystem is the source of truth

Everything is a file on disk. There is no database, no in-memory store, no separate
"task store" class. A task exists because `data/tasks/<id>.json` exists. A task's status
is whatever `status` field is in that JSON file. Period.

### 2. State machine = filesystem

The board columns are defined in `data/board.json`. The transitions are implicit in the
column order. An agent reads the task file, changes the `status` field, writes it back. Done.
If we want explicit transition rules later, that's a `data/pipeline.json` file — still just
filesystem.

### 3. Task store = filesystem

The Express REST API reads/writes `data/tasks/*.json` via VFS + NativeFsProvider. The
KanbanBoard UI reads/writes the same files via client VFS + KanbanSync. There is no separate
store to build.

### 4. Agent registry = filesystem

Agents are directories under `server/agents/`. Each has a `config.json`. The server reads
those at boot. The filesystem IS the registry.

### 5. What we actually need to build

| Component | Status | Why |
|-----------|--------|-----|
| State machine | **= FS** (done) | `board.json` columns + task `status` field |
| Task store | **= FS** (done) | `data/tasks/*.json` + REST API + VFS |
| Agent registry | **= FS** (done) | `server/agents/*/config.json` |
| **Event bus** | **Need this** | chokidar already detects file changes — we hook into it to detect status transitions |
| **Runner** | **Need this** | Control plane that gates whether agents fire |

**So we build two things: the Runner and some agents. That's it.**

---

## Step 1: Runner + Agents That Update the FS

This is the first and primary deliverable. Get the Runner working and a few agents that
actually read task files, call an LLM, write results back, and move the task to the next
column — all by writing to the filesystem.

### What "done" looks like for Step 1

1. Server boots with Runner in `stopped` mode
2. User creates a task in the UI → appears in Inbox
3. User drags task to Assigned
4. User clicks "Start" on RunnerControls
5. Planning agent fires: reads task JSON, calls LLM, writes plan + new status back to disk
6. chokidar detects the write → broadcasts to UI → task appears in In Progress
7. Progress agent fires automatically → task moves to Testing
8. Testing agent → Review
9. Review agent → Done (or back to In Progress if rejected)
10. Completion agent fires on Done → writes docs/changelog into task metadata
11. User can Pause/Stop/Step through the pipeline at any point

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER (existing, minimal changes)                                │
│  KanbanBoard (@lifo-sh/ui) + KanbanSync + RunnerControls (NEW)     │
├────────── REST + WebSocket (existing) ──────────────────────────────┤
│  SERVER                                                             │
│                                                                     │
│   data/tasks/*.json  ←──── THE SOURCE OF TRUTH ────→  chokidar     │
│         ↑ write                                          │ detect   │
│         │                                                ↓          │
│   ┌─────┴─────┐     dispatch     ┌──────────┐     ┌────────────┐  │
│   │  Agents   │ ◄──────────────── │  Runner  │ ◄── │ status Δ?  │  │
│   │ (LLM call │     if mode=      │ (gate)   │     │ (compare   │  │
│   │  + write) │     running       └──────────┘     │  old→new)  │  │
│   └───────────┘                                     └────────────┘  │
│                                                                     │
│   Agents: planning / progress / testing / review / completion       │
└─────────────────────────────────────────────────────────────────────┘
```

**The loop:**
1. Something writes a task file (user via UI, agent, CLI, anything)
2. chokidar detects the file change
3. Server compares old status → new status
4. If status changed → asks Runner "should I dispatch an agent?"
5. Runner says yes/no based on its mode (running/paused/stopped/step)
6. If yes → agent reads task JSON, calls LLM, writes result + new status back to disk
7. → back to step 2 (chokidar detects the agent's write)

---

## File Structure (only new files)

```
apps/kanban-dev/
├── .env                               # OPENROUTER_API_KEY=...
├── data/
│   ├── runner.json                    # Runner persisted state
│   └── pipeline.json                  # Transition rules (optional, for loop limits)
│
├── server/
│   ├── index.ts                       # MODIFY: wire runner + status-change detection
│   ├── runner.ts                      # NEW: control plane
│   ├── llm.ts                         # NEW: OpenRouter wrapper
│   └── agents/
│       ├── types.ts                   # NEW: shared interfaces
│       ├── skill-loader.ts            # NEW: reads SKILL.md → prompt
│       ├── planning/
│       │   ├── config.json
│       │   ├── index.ts
│       │   └── skills/...
│       ├── progress/
│       │   ├── config.json
│       │   ├── index.ts
│       │   └── skills/...
│       ├── testing/
│       │   ├── config.json
│       │   ├── index.ts
│       │   └── skills/...
│       ├── review/
│       │   ├── config.json
│       │   ├── index.ts
│       │   └── skills/...
│       └── completion/
│           ├── config.json
│           ├── index.ts
│           └── skills/...
│
├── src/
│   ├── main.ts                        # MODIFY: add RunnerControls
│   ├── sync.ts                        # MODIFY: handle runner-status WS messages
│   └── runner-controls.ts             # NEW: vanilla DOM control bar
│
└── index.html                         # MODIFY: add runner-controls container
```

---

## Runner (`server/runner.ts`)

The Runner is a gate. It decides whether to dispatch an agent when a status change is
detected. Four modes:

| Mode | What happens when a status change is detected |
|------|----------------------------------------------|
| **running** | Dispatch the agent immediately |
| **paused** | Queue the dispatch (FIFO). In-flight agents finish but next dispatch queues. |
| **stopped** | Drop it. No agents fire. Board is manual only. Default on first boot. |
| **step** | Forward ONE queued dispatch, then stay in step mode. |

```typescript
interface QueueEntry {
  taskId: string;
  taskPath: string;
  fromStatus: string;
  toStatus: string;
  agentName: string;
  queuedAt: string;
}

interface RunnerStatus {
  mode: 'running' | 'paused' | 'stopped' | 'step';
  queueLength: number;
  queue: QueueEntry[];
  stats: {
    totalForwarded: number;
    totalDropped: number;
    totalQueued: number;
    lastEventAt: string | null;
  };
  startedAt: string | null;
  pausedAt: string | null;
}

class Runner {
  mode: 'running' | 'paused' | 'stopped' | 'step';
  queue: QueueEntry[];
  stats: { ... };

  private configPath: string;       // data/runner.json
  private dispatchFn: (entry: QueueEntry) => Promise<void>;

  constructor(configPath: string)
    // Reads runner.json. If missing, creates with mode: "stopped".

  setDispatcher(fn: (entry: QueueEntry) => Promise<void>): void

  start(): RunnerStatus       // mode → running. Drains queue.
  pause(): RunnerStatus       // mode → paused. In-flight finishes, next events queue.
  stop(): RunnerStatus        // mode → stopped. Queue cleared.
  step(): RunnerStatus        // Requires paused/step. Forwards ONE. Stays in step.

  requestDispatch(entry: QueueEntry): void
    // running → dispatch immediately
    // paused/step → push to queue
    // stopped → drop

  getStatus(): RunnerStatus
  clearQueue(): void

  private persist(): void      // writeFileSync to runner.json
  private drainQueue(): void   // forward all queued entries sequentially
  private forwardOne(): void   // forward first entry, remove from queue
}
```

### Pause is safe, Stop is destructive

- **Pause**: events accumulate in the queue. Resume (start) drains them all.
- **Stop**: queue is cleared. Events are lost. Tasks sit where they are.

### API Routes (added to server/index.ts)

```
POST   /api/runner/start      → runner.start()
POST   /api/runner/pause      → runner.pause()
POST   /api/runner/stop       → runner.stop()
POST   /api/runner/step       → runner.step()
GET    /api/runner/status      → runner.getStatus()
DELETE /api/runner/queue       → runner.clearQueue()
```

All POST endpoints return the full RunnerStatus so the UI updates immediately.

---

## Status Change Detection (the "event bus")

We don't build a separate EventBus. chokidar already watches `data/tasks/`. We add a thin
layer that remembers the last known status of each task and detects when it changes.

**In `server/index.ts`, we add:**

```typescript
// Cache: taskId → last known status
const statusCache = new Map<string, string>();

// On boot: populate cache from existing task files
for (const entry of vfs.readdir('/kanban/tasks')) {
  if (entry.type === 'file' && entry.name.endsWith('.json')) {
    try {
      const task = JSON.parse(vfs.readFileString('/kanban/tasks/' + entry.name));
      statusCache.set(task.id, task.status);
    } catch { /* skip */ }
  }
}

// In the existing chokidar handler, AFTER the broadcast:
if (event !== 'unlink' && content) {
  try {
    const task = JSON.parse(content);
    const oldStatus = statusCache.get(task.id);
    statusCache.set(task.id, task.status);

    if (oldStatus && oldStatus !== task.status) {
      // Status changed! Find the agent for the NEW status.
      const agent = findAgentForStatus(task.status);
      if (agent) {
        runner.requestDispatch({
          taskId: task.id,
          taskPath: path.join(TASKS_DIR, task.id + '.json'),
          fromStatus: oldStatus,
          toStatus: task.status,
          agentName: agent.name,
          queuedAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* malformed JSON */ }
}
```

This is ~20 lines added to the existing chokidar handler. No new classes, no EventBus.

---

## Agent Mapping

Which agent fires for which status:

| Task enters status | Agent that fires | Agent's job | Moves task to |
|-------------------|-----------------|-------------|---------------|
| `assigned` | planning-agent | Break down task, create plan | `in_progress` |
| `in_progress` | progress-agent | Generate implementation | `testing` |
| `testing` | testing-agent | Validate implementation | `review` |
| `review` | review-agent | Code review, approve/reject | `done` or `in_progress` |
| `done` | completion-agent | Generate docs/changelog | stays in `done` |

`inbox` has no agent — that's where users create tasks. Moving from inbox → assigned is
a human action ("assign this to the pipeline").

---

## LLM Wrapper (`server/llm.ts`)

```typescript
interface LLMOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;            // default: 'anthropic/claude-sonnet-4-20250514'
  apiKey: string;
  maxRetries?: number;       // default: 3
  retryDelayMs?: number;     // default: 2000
  timeoutMs?: number;        // default: 60000
}

async function callLLM(options: LLMOptions): Promise<string>
  // POST to https://openrouter.ai/api/v1/chat/completions
  // Retry on 429/5xx with exponential backoff
  // Return choices[0].message.content
```

---

## Agent Pattern

Every agent follows the same structure:

```typescript
// server/agents/{name}/index.ts
export const config = { /* from config.json */ };

export async function handle(task: Task, taskPath: string, apiKey: string): Promise<void> {
  // 1. Build system prompt (with skills injected)
  // 2. Build user message from task data
  // 3. Add activity: { type: 'agent_started', by: config.name }
  // 4. Call LLM
  // 5. Parse result → write to task.metadata
  // 6. Update task.status to target status
  // 7. Add activity: { type: 'agent_output', by: config.name }
  // 8. fs.writeFileSync(taskPath, JSON.stringify(task, null, 2))
  //    ↑ This single write triggers chokidar → next agent
  //
  // On error:
  // - Add activity: { type: 'agent_error', by: config.name }
  // - Do NOT change status (task stays put)
  // - Write the error activity to disk so UI shows it
}
```

**The agent writes to the filesystem. That's the ONLY thing it does to communicate.
chokidar picks it up. The cycle continues.**

---

## Extended Task Schema

Backward compatible — just adds optional fields:

```typescript
interface KanbanTask {
  // Existing (unchanged)
  id: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assignee: string | null;
  assignee_type: 'human' | 'agent' | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deliverables: KanbanDeliverable[];
  activity: KanbanActivity[];

  // New (optional, added by agents)
  metadata?: {
    plan?: { ... };            // planning-agent output
    implementation?: { ... };  // progress-agent output
    testResults?: { ... };     // testing-agent output
    review?: { ... };          // review-agent output
    completion?: { ... };      // completion-agent output
  };
  transition_count?: Record<string, number>;  // "review→in_progress": 2
}
```

Activity types extended:
```typescript
type: 'created' | 'status_changed' | 'assigned' | 'note' | 'updated'
    | 'agent_started' | 'agent_output' | 'agent_error';   // new
```

---

## UI: RunnerControls (`src/runner-controls.ts`)

Vanilla DOM (matches existing KanbanBoard pattern). No React.

```
┌──────────────────────────────────────────────────────────────┐
│  ● STOPPED     [▶ Start]  [⏸ Pause]  [■ Stop]  [⏭ Step]    │
│                Queue: 0                                      │
└──────────────────────────────────────────────────────────────┘
```

- Polls `GET /api/runner/status` every 2s
- Buttons call `POST /api/runner/{start,pause,stop,step}`
- Status dot: red=stopped, green=running, amber=paused, blue=step
- Button enable/disable based on mode:
  - STOPPED → Start enabled, rest disabled
  - RUNNING → Pause + Stop enabled, rest disabled
  - PAUSED → Start + Stop + Step enabled, Pause disabled
  - STEP → Start + Stop + Step enabled, Pause disabled

---

## Agent-Activity over WebSocket

Add a new WS message type so the UI can show agent activity in real-time:

```typescript
broadcast({
  type: 'agent-activity',
  taskId: string,
  agent: string,
  action: 'started' | 'completed' | 'error',
  message: string,
  timestamp: string,
});
```

The existing KanbanBoard already re-renders on any task file change (via KanbanSync + VFS
watch), so agent writes to task metadata/activity are automatically visible.

---

## Build Order

```
1. Create .env with OPENROUTER_API_KEY placeholder
2. Create data/runner.json (default: stopped)
3. Create data/pipeline.json (transition rules + loop limits)
4. npx pnpm add dotenv (add to dependencies)

5. Build server/runner.ts (control plane)
6. Build server/llm.ts (OpenRouter wrapper)
7. Build server/agents/types.ts (shared interfaces)
8. Build server/agents/skill-loader.ts

9. Build agents (each: config.json + skills/ + index.ts):
   a. planning agent
   b. progress agent
   c. testing agent
   d. review agent
   e. completion agent

10. Modify server/index.ts:
    - Import runner, agents
    - Add status cache + status-change detection in chokidar handler
    - Wire runner dispatcher to agent dispatch
    - Add /api/runner/* routes
    - Restore runner mode on boot

11. Build src/runner-controls.ts (vanilla DOM)
12. Modify src/main.ts — mount RunnerControls
13. Modify index.html — add container div
14. Modify src/sync.ts — handle agent-activity WS messages
```

---

## Test Plan

### Smoke Test
1. `npx pnpm dev` → open http://localhost:5173
2. Verify Runner shows STOPPED (red dot)
3. Create a task → appears in Inbox. No agent fires.
4. Drag task to Assigned. Still nothing (runner is stopped).
5. Click Start → RUNNING (green dot)
6. Observe: planning-agent fires → task moves to In Progress → progress-agent fires → ...
7. Task flows through to Done
8. Check task JSON on disk: metadata populated at each stage, activity log shows agent entries

### Pause/Resume
1. Runner running, drag a task to Assigned
2. While agent is processing, click Pause
3. Agent finishes its current LLM call, writes result
4. Next agent dispatch is QUEUED (check queue counter)
5. Click Start → queue drains, pipeline continues

### Step Mode
1. Runner paused, drag a task to Assigned → queued
2. Click Step → planning agent fires for ONE task
3. Click Step → progress agent fires
4. Walk through the entire pipeline one step at a time

### Stop (destructive)
1. Runner running, task mid-pipeline
2. Click Stop → queue cleared, no more agents fire
3. Task sits in whatever column it reached
4. Click Start, drag task manually → pipeline resumes from there

### Loop Test
1. Create a vague task, start runner, drag to Assigned
2. If review rejects → loops in_progress → testing → review
3. After maxTransitionsPerEdge (3), review forces Done with a note

### Restart Persistence
1. Runner running, tasks on board, kill server
2. Restart → runner resumes in previous mode, board intact
