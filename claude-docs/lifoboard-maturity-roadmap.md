# Lifoboard Maturity Roadmap
## From Working Prototype → Mature OpenClaw-Style Agent Platform

---

## Current State (What's Already Built)

The system is architecturally complete and wired end-to-end:

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

The engine works. Cards move through the pipeline, agents call the LLM, metadata is written to disk. The gaps are in **visibility**, **agent quality**, and **platform extensibility**.

---

## Gap Analysis: 10 Things Missing

### Gap 1 — Task Detail Panel (No UI for Agent Output)

**Problem:** Agents write rich metadata to every task JSON — plan steps, implementation changes, test results, review decision, completion changelog. But the board shows none of it. All that data lives on disk, completely invisible.

**What's needed:**
- Click any card → slide-in panel from the right
- Sections per agent stage: Plan, Implementation, Test Results, Review, Completion
- Full activity timeline with agent icons and timestamps
- Readable display of `task.metadata.*` fields

**Files to create:**
- `src/task-panel.ts` — vanilla DOM component
- Wire into `src/main.ts` and `index.html`

**Impact: Highest.** The whole pipeline runs but its output is invisible. This single change transforms "cards moving between columns" into "a visible AI work pipeline."

---

### Gap 2 — No Agent Activity Indicator on Cards

**Problem:** When an agent is processing a task, the card looks identical to an idle card. There's no spinner, glow, or "in progress" indicator.

**What's needed:**
- When `agent-activity: started` WS message arrives, find the card by `taskId` and add a visual indicator (pulsing border, spinner badge)
- Remove indicator when `agent-activity: completed` or `agent-activity: error` arrives

**Files to modify:**
- `src/sync.ts` — emit DOM events when agent-activity messages arrive
- `src/main.ts` — listen and manipulate card DOM

**Impact: High.** Makes the pipeline feel alive.

---

### Gap 3 — No Skill Files Exist

**Problem:** `loadSkills()` is fully implemented and wired into every agent. The `skills/` directory structure is expected. But no `.md` skill files actually exist in any agent directory. The skill system is running on empty.

**What's needed — one SKILL.md per agent:**

```
server/agents/planning/skills/SKILL.md    — how to break down tasks well
server/agents/progress/skills/SKILL.md   — how to describe implementation changes
server/agents/testing/skills/SKILL.md    — how to write test scenarios
server/agents/review/skills/SKILL.md     — how to review code/plans fairly
server/agents/completion/skills/SKILL.md — how to write good changelogs
```

Each file is 10–30 lines of markdown that gives the agent domain expertise via the system prompt.

**Impact: Medium.** Improves LLM output quality for all agents with minimal code changes.

---

### Gap 4 — Agents Don't Pass Context Forward

**Problem:** Most agents only receive `task.title + task.description`. The review agent does build context from prior stages (lines 45–54 of `review/index.ts`). The others don't.

**Current state:**
- `planning` agent: gets title + description ✓ (correct, it starts fresh)
- `progress` agent: gets title + description ✗ (should also get the plan)
- `testing` agent: gets title + description ✗ (should get plan + implementation)
- `review` agent: gets title + description + plan + impl + test ✓ (already done correctly)
- `completion` agent: should get the full picture too

**What's needed:** Update `progress` and `testing` agents to build context from prior `task.metadata.*` fields, following the pattern already in `review/index.ts`.

**Files to modify:**
- `server/agents/progress/index.ts`
- `server/agents/testing/index.ts`

**Impact: Medium.** Better agent chain coherence — progress implements the actual plan, testing tests the actual implementation.

---

### Gap 5 — No Model Routing Per Agent

**Problem:** All 5 agents use `anthropic/claude-sonnet-4.5` by default. OpenClaw routes models by task type to balance quality vs cost vs speed.

**Proposed model assignment:**

| Agent | Model | Reason |
|---|---|---|
| planning | `anthropic/claude-opus-4.6` | Deep reasoning for task decomposition |
| progress | `anthropic/claude-sonnet-4-5` | Balanced speed/quality for implementation |
| testing | `anthropic/claude-haiku-4-5-20251001` | Quick validation, no deep reasoning needed |
| review | `anthropic/claude-sonnet-4-5` | Needs judgment but not opus-level |
| completion | `anthropic/claude-haiku-4-5-20251001` | Simple summarization |

**What's needed:**
- Add `"model": "..."` field to each agent's `config.json`
- Update `AgentConfig` interface in `server/agents/types.ts` to include optional `model?: string`
- Pass `config.model` into `callLLM()` in each agent's `handle()` function

**Files to modify:**
- `server/agents/types.ts`
- All 5 `config.json` files
- All 5 agent `index.ts` files (one-liner change each)

**Impact: Medium.** Lower cost on fast agents, better quality on planning.

---

### Gap 6 — Loop Protection Is LLM-Prompt-Only

**Problem:** The review agent's infinite-loop prevention is baked into the LLM prompt ("you MUST approve after 2 rejections"). This relies on the LLM following instructions, which is not guaranteed. A bad response could still produce `approved: false` and loop forever.

**What's needed:** Move the `maxTransitionsPerEdge` check into the server-side dispatcher (`server/index.ts`) so it's enforced in code, not in a prompt.

```typescript
// In the dispatcher, before calling agent.handle():
const edgeKey = `${entry.fromStatus}→${entry.toStatus}`;
const pipelineConfig = loadPipeline(); // read data/pipeline.json
const transitionCount = task.transition_count?.[edgeKey] || 0;
if (transitionCount >= pipelineConfig.maxTransitionsPerEdge) {
  // Force task to done, skip agent
  task.status = 'done';
  task.activity.push({ type: 'status_changed', message: 'Max loop limit reached, forced to done', ... });
  fs.writeFileSync(entry.taskPath, JSON.stringify(task, null, 2));
  return;
}
```

**Files to modify:**
- `server/index.ts` — add pre-dispatch loop check

**Impact: Low effort, high safety.** Prevents runaway pipelines.

---

### Gap 7 — No Cross-Task Memory

**Problem:** Each agent call is completely isolated. No awareness of prior completed tasks. Over time a project builds up patterns, common issues, recurring decisions — none of that is available to agents.

**Proposed approach:**
- `data/memory/` directory — summary files per completed task
- `completion-agent` writes a brief `data/memory/<taskId>-summary.txt` after finishing
- `planning-agent` reads the 5 most recent summaries and includes them in context

```
data/memory/
├── abc-123-summary.txt   "Implemented JWT auth — used bcrypt, 4 endpoints"
├── def-456-summary.txt   "Fixed drag-drop bug — root cause was event bubbling"
└── ...
```

**Files to modify/create:**
- `server/agents/completion/index.ts` — write memory file after completing
- `server/agents/planning/index.ts` — read recent memory files for context
- No schema changes needed

**Impact: Medium effort, high long-term value.** Makes the system smarter over time.

---

### Gap 8 — No External Input Channels

**Problem:** The architecture explicitly supports "any process writing to `data/tasks/`" as a first-class input method. But no actual integrations exist. The CLI is a one-liner that could exist today.

**Proposed `lifo` CLI:**
```bash
# Add a task to the board
node apps/kanban-dev/cli.js add "Write unit tests for auth module"

# Add with description
node apps/kanban-dev/cli.js add "Fix login bug" --desc "Users can't log in with email containing +symbol"

# List all tasks
node apps/kanban-dev/cli.js list
```

**Files to create:**
- `apps/kanban-dev/cli.js` — ~50 lines, just `POST /api/tasks`

**Impact: Low effort, great developer experience.** Lets you pipe tasks from scripts, git hooks, CI, etc.

---

### Gap 9 — No Custom Pipeline Per Task

**Problem:** Every task uses the same linear pipeline: `inbox → assigned → in_progress → testing → review → done`. Some tasks are simple and don't need a testing or review stage. There's no way to express this.

**Proposed approach:** Add optional `pipeline?: string[]` field to the task JSON.

```json
{
  "id": "abc-123",
  "title": "Update README",
  "pipeline": ["assigned", "done"],  // skip everything, just complete it
  ...
}
```

If `task.pipeline` is set, the dispatcher uses it to determine the next status instead of `pipeline.json`. If not set, falls back to the global pipeline.

**Files to modify:**
- `server/agents/types.ts` — add `pipeline?: string[]` to `KanbanTask`
- `server/index.ts` — check `task.pipeline` before dispatching next agent
- Task creation UI — add optional pipeline selector

**Impact: Medium.** Unlocks task-level routing flexibility.

---

### Gap 10 — Runner Controls Don't Show Active Agent

**Problem:** The RunnerControls shows mode (RUNNING/PAUSED/etc.) and queue count, but not **which agent is currently running on which task**. You have to watch the log panel to find out.

**What's needed:** When `agent-activity: started` arrives, show it in the RunnerControls bar:
```
● RUNNING   [▶ Start] [⏸ Pause] [■ Stop] [⏭ Step]   Queue: 0
  ↳ planning-agent → task "Write unit tests" (abc-123...)
```
Clear it when `agent-activity: completed` or `error` arrives.

**Files to modify:**
- `src/runner-controls.ts` — add active agent display slot
- `src/main.ts` — pipe agent-activity events to RunnerControls

**Impact: Low effort, nice polish.** Makes the runner feel like an actual control plane.

---

## Prioritized Build Order

### Phase 1 — Make what's built actually visible

| # | Task | Files | Effort | Impact |
|---|---|---|---|---|
| 1 | Task Detail Panel | `src/task-panel.ts` (new), `src/main.ts`, `index.html` | M | Highest |
| 2 | Agent activity indicator on cards | `src/sync.ts`, `src/main.ts` | S | High |
| 3 | Skill files for all agents | 5× `skills/SKILL.md` | S | Medium |

### Phase 2 — Make agents smarter

| # | Task | Files | Effort | Impact |
|---|---|---|---|---|
| 4 | Context chain (progress + testing) | `server/agents/progress/index.ts`, `testing/index.ts` | S | Medium |
| 5 | Model routing per agent | 5× `config.json`, `types.ts`, 5× `index.ts` | S | Medium |
| 6 | Server-side loop enforcement | `server/index.ts` | S | High safety |

### Phase 3 — Extend the platform

| # | Task | Files | Effort | Impact |
|---|---|---|---|---|
| 7 | Cross-task memory | `completion/index.ts`, `planning/index.ts` | M | High long-term |
| 8 | `lifo` CLI | `cli.js` (new) | S | Good DX |
| 9 | Custom pipeline per task | `types.ts`, `index.ts`, task creation UI | M | Flexibility |
| 10 | Active agent in RunnerControls | `runner-controls.ts`, `main.ts` | S | Polish |

**Effort key:** S = Small (< 1 hour), M = Medium (2–4 hours)

---

## The Single Most Impactful Change

**Build the Task Detail Panel (Gap 1).**

Right now the whole agent pipeline runs and produces structured output — plans, implementation summaries, test results, review decisions — but none of it is visible. The kanban board just shows cards moving between columns.

Once you can click a card and see:
- The 5-step plan the planning agent created
- What the progress agent says it implemented
- Whether tests passed and what issues were found
- The review decision with feedback
- The full agent activity timeline

...the system transforms from "a toy that moves cards" into "an actual AI work pipeline with observable, auditable output."

Everything else on this list makes the system better. The task detail panel makes it *real*.

---

## Quick Reference: File Map

```
apps/kanban-dev/
├── server/
│   ├── index.ts                    # Gap 6: add server-side loop check
│   ├── llm.ts                      # No changes needed
│   ├── runner.ts                   # No changes needed
│   └── agents/
│       ├── types.ts                # Gap 5, 9: add model field, pipeline field
│       ├── skill-loader.ts         # No changes needed
│       ├── planning/
│       │   ├── config.json         # Gap 5: add "model" field
│       │   ├── index.ts            # Gap 7: read memory; Gap 4: N/A (starts fresh)
│       │   └── skills/SKILL.md     # Gap 3: CREATE THIS
│       ├── progress/
│       │   ├── config.json         # Gap 5: add "model" field
│       │   ├── index.ts            # Gap 4: add plan context
│       │   └── skills/SKILL.md     # Gap 3: CREATE THIS
│       ├── testing/
│       │   ├── config.json         # Gap 5: add "model" field
│       │   ├── index.ts            # Gap 4: add plan+impl context
│       │   └── skills/SKILL.md     # Gap 3: CREATE THIS
│       ├── review/
│       │   ├── config.json         # Gap 5: add "model" field
│       │   ├── index.ts            # Already has context chain ✓
│       │   └── skills/SKILL.md     # Gap 3: CREATE THIS
│       └── completion/
│           ├── config.json         # Gap 5: add "model" field
│           ├── index.ts            # Gap 7: write memory file
│           └── skills/SKILL.md     # Gap 3: CREATE THIS
│
├── src/
│   ├── main.ts                     # Gap 1, 2, 10: wire new components
│   ├── sync.ts                     # Gap 2: emit agent-activity DOM events
│   ├── runner-controls.ts          # Gap 10: add active agent display
│   ├── log-panel.ts                # No changes needed
│   └── task-panel.ts               # Gap 1: CREATE THIS (task detail panel)
│
├── data/
│   ├── board.json                  # No changes needed
│   ├── pipeline.json               # No changes needed
│   ├── runner.json                 # No changes needed
│   └── memory/                     # Gap 7: CREATE THIS directory
│
├── index.html                      # Gap 1: add task-panel container
└── cli.js                          # Gap 8: CREATE THIS
```
