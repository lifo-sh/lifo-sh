# Lifoboard — Simplified OpenClaw with Kanban UI
## Implementation Overview & Architecture

---

## 1. The Core Concept

OpenClaw is a full personal AI assistant — channels, pairing, sandbox, subagents, MCP bridge,
20+ messaging integrations. Complex by necessity.

**Lifoboard is the same idea, stripped to the essential engine:**

> A file-driven agent pipeline where the Kanban board *is* the channel.
> Instead of a WhatsApp message triggering an agent, dragging a card to a column triggers it.

The insight: OpenClaw's real value is not the messaging integrations. It's the **control
plane** (Runner) + **agent dispatch loop** + **skill system** + **LLM calls**. Everything
else is delivery packaging. Lifoboard takes the engine and replaces the packaging with a
visible, interactive Kanban UI.

---

## 2. Conceptual Mapping: OpenClaw → Lifoboard

```
OpenClaw Concept          │  Lifoboard Equivalent
──────────────────────────┼──────────────────────────────────────────────
Gateway server            │  Express server (server/index.ts)
Messaging channels        │  Kanban board columns (the board IS the channel)
  WhatsApp message in     │    Task dragged to "Assigned" column
  Reply sent out          │    Agent writes result to task JSON
Session                   │  A single task JSON file (data/tasks/<id>.json)
Agent runner              │  Runner class (server/runner.ts)
LLM integration           │  callLLM() (server/llm.ts) → OpenRouter
Skills (SKILL.md files)   │  server/agents/*/skills/ markdown prompts
Plugin config             │  server/agents/*/config.json
Memory / context          │  task.metadata.* fields (persisted per-task)
Web control UI            │  KanbanBoard + RunnerControls + LogPanel
Event bus                 │  chokidar watching data/tasks/ (filesystem events)
Session persistence       │  data/tasks/*.json (native filesystem)
Auto-reply loop           │  status transition → agent dispatch → next status
```

**What is deliberately NOT included** (vs full OpenClaw):
- No messaging channels (WhatsApp, Telegram, Slack, Discord, Signal…)
- No device pairing or auth rotation
- No sandbox execution environment
- No subagent spawning registry / nested agents
- No compaction / context-window management
- No MCP bridge
- No Docker / daemon / systemd service

---

## 3. High-Level Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════╗
║  BROWSER LAYER (Vite SPA)                                                ║
║                                                                          ║
║  ┌─────────────────────────────────────────────────────────────────┐    ║
║  │  KanbanBoard (@lifo-sh/ui)                                      │    ║
║  │                                                                 │    ║
║  │  [Inbox] → [Assigned] → [In Progress] → [Testing] → [Done]     │    ║
║  │      ↑                                                          │    ║
║  │      │  drag card = REST PUT /api/tasks/:id                     │    ║
║  └──────┼──────────────────────────────────────────────────────────┘    ║
║         │                                                                ║
║  ┌──────┼──────────────────────────────────────────────────────────┐    ║
║  │  RunnerControls          LogPanel                               │    ║
║  │  [▶ Start][⏸ Pause]     [info] planning-agent started          │    ║
║  │  [■ Stop][⏭ Step]       [info] agent completed                 │    ║
║  │  Queue: 2  ● RUNNING    [err ] agent error: ...                │    ║
║  └──────────────────────────────────────────────────────────────────┘    ║
║                                                                          ║
║  KanbanSync: WebSocket client ←→ VFS mirror                             ║
╚══════════════════════╦═══════════════════════════════════════════════════╝
                       ║  REST + WebSocket  (localhost:3001)
╔══════════════════════╩═══════════════════════════════════════════════════╗
║  SERVER LAYER (Express + Node)                                           ║
║                                                                          ║
║  ┌─────────────────────────────────────────────────────────────────┐    ║
║  │  REST API                  WebSocket                            │    ║
║  │  GET/POST /api/tasks       broadcast: task-updated              │    ║
║  │  PUT/DELETE /api/tasks/:id broadcast: task-deleted              │    ║
║  │  GET /api/runner/status    broadcast: runner-status             │    ║
║  │  POST /api/runner/start    broadcast: agent-activity            │    ║
║  │  POST /api/runner/pause    broadcast: server-log                │    ║
║  │  POST /api/runner/stop                                          │    ║
║  │  POST /api/runner/step                                          │    ║
║  └───────────────────────────┬─────────────────────────────────────┘    ║
║                              │                                           ║
║  ┌───────────────────────────▼─────────────────────────────────────┐    ║
║  │  Runner (control plane)                                         │    ║
║  │                                                                 │    ║
║  │  mode: stopped → running → paused → step → running             │    ║
║  │                                                                 │    ║
║  │  requestDispatch(entry)                                         │    ║
║  │    running  → dispatch immediately                              │    ║
║  │    paused   → push to queue                                     │    ║
║  │    step     → push to queue (forward one on next step())        │    ║
║  │    stopped  → drop                                              │    ║
║  └───────────────────────────┬─────────────────────────────────────┘    ║
║                              │ dispatch                                  ║
║  ┌───────────────────────────▼─────────────────────────────────────┐    ║
║  │  Agent Dispatcher                                               │    ║
║  │                                                                 │    ║
║  │  agentByTrigger Map:                                            │    ║
║  │    "assigned"    → planning-agent                               │    ║
║  │    "in_progress" → progress-agent                               │    ║
║  │    "testing"     → testing-agent                                │    ║
║  │    "review"      → review-agent                                 │    ║
║  │    "done"        → completion-agent                             │    ║
║  └───────────────────────────┬─────────────────────────────────────┘    ║
║                              │                                           ║
╚══════════════════════════════╬═══════════════════════════════════════════╝
                               │
╔══════════════════════════════╩═══════════════════════════════════════════╗
║  FILESYSTEM LAYER (Source of Truth)                                      ║
║                                                                          ║
║  data/tasks/<id>.json   ←──── agents read & write here                  ║
║  data/runner.json        ←──── runner persists its mode & queue          ║
║  data/pipeline.json      ←──── transition rules & loop limits            ║
║  data/board.json         ←──── column definitions                        ║
║                                                                          ║
║  chokidar watches data/tasks/                                            ║
║    external write detected → compare old/new status → requestDispatch    ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 4. The Agent Pipeline — Full Data Flow

```
USER ACTION (drag card or API call)
         │
         ▼
PUT /api/tasks/:id  { status: "assigned" }
         │
         ├─ 1. Write task.json to disk (VFS / NativeFsProvider)
         ├─ 2. Update statusCache (id → "assigned")
         ├─ 3. broadcast(task-updated) → UI re-renders
         └─ 4. findAgentForStatus("assigned") → planning-agent
                        │
                        ▼
              runner.requestDispatch(entry)
                        │
              ┌─────────┴──────────┐
              │ mode = "running" ? │
              └─────────┬──────────┘
                   YES  │  NO → queue / drop
                        ▼
         ┌──────────────────────────────┐
         │  planning-agent.handle()     │
         │                              │
         │  1. Read task.json           │
         │  2. Append agent_started     │
         │  3. Write to disk (notify UI)│
         │  4. callLLM(systemPrompt +   │
         │       skills + task data)    │
         │  5. Parse JSON response      │
         │  6. task.metadata.plan = ... │
         │  7. task.status = "in_prog.."│
         │  8. Append agent_output      │
         │  9. Write task.json to disk  │
         └──────────────┬───────────────┘
                        │  single fs.writeFileSync
                        ▼
         dispatcher detects new status "in_progress"
                        │
                        ▼
              runner.requestDispatch(entry)
         ┌──────────────────────────────┐
         │  progress-agent.handle()     │
         └──────────────┬───────────────┘
                        │
                        ▼
                   task → "testing"
         ┌──────────────────────────────┐
         │  testing-agent.handle()      │
         └──────────────┬───────────────┘
                        │
                        ▼
                   task → "review"
         ┌──────────────────────────────┐
         │  review-agent.handle()       │
         │                              │
         │  approved? → "done"          │
         │  rejected? → "in_progress"   │
         │  (max 3 loops then force done)│
         └──────────────┬───────────────┘
                        │
                        ▼
                   task → "done"
         ┌──────────────────────────────┐
         │  completion-agent.handle()   │
         │  (generates changelog/docs)  │
         │  stays in "done"             │
         └──────────────────────────────┘
```

---

## 5. Agent Anatomy

Every agent follows the same pattern. Here's the template:

```
server/agents/<name>/
├── config.json          ← identity & routing
├── index.ts             ← handle() function
└── skills/              ← optional markdown skill files
    └── SKILL.md
```

### config.json

```json
{
  "name": "planning-agent",
  "description": "Breaks down a task into a concrete plan",
  "triggerStatus": "assigned",
  "targetStatus": "in_progress",
  "rejectTarget": null
}
```

### handle() lifecycle

```
1. Read task from disk (passed as arg)
2. Append { type: "agent_started" } to task.activity
3. Write to disk → UI sees "agent working"
4. Build system prompt = SYSTEM_PROMPT + skills
5. callLLM({ systemPrompt, userMessage: task title + description })
6. Parse LLM JSON response
7. Write result to task.metadata.<field>
8. Update task.status to config.targetStatus
9. Append { type: "agent_output" } to task.activity
10. Single fs.writeFileSync → chokidar detects → next agent fires
```

### On error:

```
- Append { type: "agent_error" } to task.activity
- Do NOT change task.status (task stays in current column)
- Write error to disk so UI shows it
- Throw the error (runner logs it)
```

---

## 6. Runner State Machine

```
                  ┌─────────────────┐
                  │    STOPPED      │  ← default on first boot
                  │  (queue cleared)│
                  └────────┬────────┘
                           │ start()
                           ▼
                  ┌─────────────────┐
             ┌──▶ │    RUNNING      │ ──── requestDispatch → fires immediately
             │    └────────┬────────┘
             │             │ pause()
             │             ▼
  start()    │    ┌─────────────────┐
  (drains)   │    │    PAUSED       │ ──── requestDispatch → pushed to queue
             │    └────────┬────────┘
             └─────────────┤ step()
                           ▼
                  ┌─────────────────┐
                  │    STEP         │ ──── forwards ONE queued entry
                  │  (stays step)   │      then waits for next step()
                  └─────────────────┘

  stop() from any state → STOPPED (queue cleared)
  start() from paused/step → RUNNING (queue drains)
```

### Runner persistence

Runner state is written to `data/runner.json` on every transition.
On server restart, the runner loads its previous mode and queue — the board
continues from exactly where it left off.

---

## 7. The Event Bus — chokidar as the Nervous System

There is no separate EventEmitter or message bus. chokidar IS the event bus.

```
data/tasks/                 ← chokidar watches this directory
     │
     │  on any file change (add / change / unlink)
     ▼
statusCache comparison
  old status ≠ new status?
     │ YES
     ▼
findAgentForStatus(newStatus)
     │
     ▼
runner.requestDispatch(entry)
```

Three sources can write task files:
1. **REST API** (user via UI, curl, any HTTP client)
2. **Agents** (LLM output written back to disk)
3. **External tools** (terminal, scripts, bots, cron jobs)

All three trigger the same detection path. The system is **write-source-agnostic**.

To prevent double-triggering:
- `pendingApiWrites` set: REST writes skip the chokidar handler
- `pendingAgentWrites` set: Agent writes skip chokidar (dispatcher handles them directly)
- External writes flow through chokidar normally

---

## 8. WebSocket Message Protocol

All real-time updates flow over a single WebSocket at `ws://localhost:3001/ws`.

```
Server → Client messages:

  task-updated      { type, id, content }           ← any task file change
  task-deleted      { type, id }                    ← task file removed
  runner-status     { type, mode, queueLength, ... } ← runner state change
  agent-activity    { type, taskId, agent, action,   ← agent lifecycle events
                      message, timestamp }
  server-log        { type, level, source, message,  ← structured logs
                      meta, timestamp }

Client → Server:
  (none — clients use REST API for writes)
```

The browser maintains its own in-memory VFS. KanbanSync:
1. Hydrates on boot via `GET /api/tasks`
2. Mirrors live updates via WebSocket
3. Writes user actions (drag, create, edit) to the server via REST

The board re-renders reactively whenever the VFS changes.

---

## 9. Task JSON Schema

A task on disk looks like this (abbreviated):

```json
{
  "id": "abc-123",
  "title": "Implement user authentication",
  "description": "Add JWT-based login and registration",
  "status": "in_progress",
  "priority": "high",
  "assignee": "planning-agent",
  "assignee_type": "agent",
  "tags": ["auth", "backend"],
  "created_at": "2026-02-26T10:00:00Z",
  "updated_at": "2026-02-26T10:05:33Z",
  "deliverables": [],
  "transition_count": {
    "review→in_progress": 1
  },
  "activity": [
    { "type": "created",       "message": "Task created",       "by": "user",           "timestamp": "..." },
    { "type": "status_changed","message": "inbox → assigned",   "by": "user",           "timestamp": "..." },
    { "type": "agent_started", "message": "Planning started",   "by": "planning-agent", "timestamp": "..." },
    { "type": "agent_output",  "message": "Plan created: ...",  "by": "planning-agent", "timestamp": "..." },
    { "type": "status_changed","message": "assigned → in_prog.","by": "planning-agent", "timestamp": "..." }
  ],
  "metadata": {
    "plan": {
      "summary": "Implement JWT auth with bcrypt passwords",
      "steps": ["Set up User model", "Build /login endpoint", "..."],
      "estimatedComplexity": "medium",
      "generatedAt": "2026-02-26T10:05:00Z"
    },
    "implementation": { ... },
    "testResults": { ... },
    "review": { ... },
    "completion": { ... }
  }
}
```

Each agent appends to `activity[]` and populates its `metadata` field.
The file grows richer as the task moves through the pipeline.

---

## 10. UI Layer Breakdown

```
index.html
├── #runner-controls    ← RunnerControls vanilla DOM component
├── #board              ← KanbanBoard (@lifo-sh/ui)
└── #log-panel          ← LogPanel vanilla DOM component

src/
├── main.ts             ← boot(): wires everything together
├── sync.ts             ← KanbanSync: WS + VFS mirror
├── runner-controls.ts  ← Start/Pause/Stop/Step buttons + status dot
└── log-panel.ts        ← Scrolling log feed from server-log WS messages
```

### RunnerControls

```
┌────────────────────────────────────────────────────────────────┐
│  ● RUNNING    [▶ Start]  [⏸ Pause]  [■ Stop]  [⏭ Step]       │
│               Queue: 2 pending                                 │
└────────────────────────────────────────────────────────────────┘

Status dot color:
  red    = stopped
  green  = running
  amber  = paused
  blue   = step

Button availability:
  STOPPED → only Start enabled
  RUNNING → only Pause + Stop enabled
  PAUSED  → Start + Stop + Step enabled
  STEP    → Start + Stop + Step enabled
```

### KanbanBoard columns

```
┌──────────┬──────────┬──────────────┬──────────┬──────────┬──────┐
│  Inbox   │ Assigned │  In Progress │  Testing │  Review  │ Done │
│          │          │              │          │          │      │
│ [Task A] │ [Task B] │  [Task C]    │ [Task D] │ [Task E] │ [F]  │
│          │ (agent   │  (progress-  │ (testing │ (review- │      │
│          │  working)│   agent)     │  agent)  │  agent)  │      │
│          │          │              │          │          │      │
│ [+ New]  │          │              │          │          │      │
└──────────┴──────────┴──────────────┴──────────┴──────────┴──────┘
```

### LogPanel

```
┌──────────────────────────────────────────────────────────────────┐
│ Server Logs                                           [Clear]    │
│──────────────────────────────────────────────────────────────────│
│ 10:05:31 [info ] runner          mode → running                  │
│ 10:05:32 [info ] planning-agent  agent started for task abc-123  │
│ 10:05:45 [info ] planning-agent  agent completed for task abc-123│
│ 10:05:45 [info ] status-change   abc-123: assigned → in_progress │
│ 10:05:46 [info ] progress-agent  agent started for task abc-123  │
│ 10:06:12 [info ] progress-agent  agent completed for task abc-123│
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. UI-Free Operation

The UI is a client, not a requirement. The pipeline runs identically without it.

```bash
# All of these work with or without the browser open:

# Create a task
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"id":"t1","title":"Write tests","description":"...","status":"inbox",...}'

# Move to assigned → triggers planning agent (if runner is running)
curl -X PUT http://localhost:3001/api/tasks/t1 \
  -H "Content-Type: application/json" \
  -d '{"id":"t1","status":"assigned",...}'

# Start the runner
curl -X POST http://localhost:3001/api/runner/start

# Or write directly to the filesystem (chokidar picks it up):
echo '{"id":"t1","status":"assigned",...}' > apps/kanban-dev/data/tasks/t1.json
```

The Kanban board, the REST API, and direct filesystem writes are all first-class
input methods. The system has no preferred client.

---

## 12. Current State (What's Already Built)

As of `feat/kanban-dev-v2-openclaw-tunnel`, the full system is implemented:

| Component | File | Status |
|---|---|---|
| Express + WebSocket server | `server/index.ts` | ✓ Done |
| VFS + NativeFsProvider | `server/index.ts` | ✓ Done |
| chokidar event bus | `server/index.ts` | ✓ Done |
| Status cache + transition detection | `server/index.ts` | ✓ Done |
| REST API (tasks + runner) | `server/index.ts` | ✓ Done |
| Runner control plane | `server/runner.ts` | ✓ Done |
| LLM wrapper (OpenRouter) | `server/llm.ts` | ✓ Done |
| Agent types | `server/agents/types.ts` | ✓ Done |
| Skill loader | `server/agents/skill-loader.ts` | ✓ Done |
| Planning agent | `server/agents/planning/` | ✓ Done |
| Progress agent | `server/agents/progress/` | ✓ Done |
| Testing agent | `server/agents/testing/` | ✓ Done |
| Review agent | `server/agents/review/` | ✓ Done |
| Completion agent | `server/agents/completion/` | ✓ Done |
| KanbanSync (WS + VFS) | `src/sync.ts` | ✓ Done |
| RunnerControls UI | `src/runner-controls.ts` | ✓ Done |
| LogPanel UI | `src/log-panel.ts` | ✓ Done |
| Boot wiring | `src/main.ts` | ✓ Done |
| Board + runner layout | `index.html` | ✓ Done |
| Runner persistence | `data/runner.json` | ✓ Done |
| Pipeline rules | `data/pipeline.json` | ✓ Done |

---

## 13. Possible Extensions

The system is designed to be extended without changing the core loop:

### Add a new agent
1. Create `server/agents/<name>/config.json` (set triggerStatus + targetStatus)
2. Create `server/agents/<name>/index.ts` (implement `handle()`)
3. Import and register in `server/index.ts`
4. Done. The chokidar → Runner → Dispatcher loop handles the rest.

### Add a new input channel
Any process that writes a JSON file to `data/tasks/` or calls the REST API
becomes an input channel — no code changes to the core needed:
- A Telegram bot that creates tasks from messages
- A GitHub webhook that creates tasks from issues
- A cron job that creates daily standup tasks
- A CLI tool (`lifo add "Build feature X"`)

### Add memory / context across tasks
- Add a `data/memory/` directory
- Agents read prior completed task metadata before making LLM calls
- Builds up a project-level knowledge base over time

### Add a model router
Replace `callLLM()` with a router that picks models per agent:
- planning: claude-opus-4.6 (needs deep reasoning)
- progress: claude-sonnet-4.5 (fast implementation)
- testing: claude-haiku-4.5 (quick validation)

### Expose as an MCP server
The REST API (`/api/tasks`, `/api/runner/*`) is already an HTTP interface.
Wrapping it as an MCP server would let Claude Code itself create and manage tasks.

---

## 14. Quick Start

```bash
cd apps/kanban-dev

# 1. Set your OpenRouter API key
echo "OPENROUTER_API_KEY=sk-or-..." > .env

# 2. Install deps and start
pnpm install
pnpm dev

# 3. Open http://localhost:5173

# 4. Create a task in Inbox
# 5. Drag it to Assigned
# 6. Click ▶ Start in RunnerControls
# 7. Watch the pipeline run automatically
```

---

## 15. Key Design Principles (summary)

| Principle | Implementation |
|---|---|
| Filesystem is truth | All state is JSON files — no DB, no in-memory store |
| UI is optional | REST API + filesystem writes work identically |
| Write-source agnostic | REST / agent / external tools all trigger the same path |
| Control plane visible | Runner mode is always visible, always controllable |
| Agents are stateless | Each agent reads fresh from disk, writes result, exits |
| Skills are markdown | Prompts live in `.md` files, not hardcoded strings |
| One write, one trigger | Agent's final writeFileSync → chokidar → next agent |
| No magic | The whole loop is ~400 lines of readable TypeScript |
