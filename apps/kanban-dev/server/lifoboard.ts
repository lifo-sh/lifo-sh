/**
 * lifoboard.ts — Workspace utilities for ~/.lifoboard
 *
 * Mirrors the ~/.openclaw/workspace pattern:
 *   - Initialises the directory structure on first run
 *   - Loads SOUL.md + USER.md + MEMORY.md as agent context
 *   - Writes memory entries after task completion
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const LIFOBOARD_DIR = path.join(os.homedir(), '.lifoboard');
const WORKSPACE_DIR = path.join(LIFOBOARD_DIR, 'workspace');
const MEMORY_DIR    = path.join(LIFOBOARD_DIR, 'memory');

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Ensures ~/.lifoboard exists with all default workspace files.
 * Safe to call on every server start — only writes missing files.
 */
export function initLifoboard(): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(MEMORY_DIR,    { recursive: true });
  fs.mkdirSync(path.join(LIFOBOARD_DIR, 'agents'), { recursive: true });

  writeIfMissing(path.join(WORKSPACE_DIR, 'SOUL.md'),     SOUL_MD);
  writeIfMissing(path.join(WORKSPACE_DIR, 'USER.md'),     USER_MD);
  writeIfMissing(path.join(WORKSPACE_DIR, 'IDENTITY.md'), IDENTITY_MD);
  writeIfMissing(path.join(WORKSPACE_DIR, 'AGENTS.md'),   AGENTS_MD);
  writeIfMissing(path.join(WORKSPACE_DIR, 'MEMORY.md'),   MEMORY_MD);
  writeIfMissing(path.join(LIFOBOARD_DIR, 'config.json'), CONFIG_JSON);

  console.log(`[lifoboard] workspace ready at ${LIFOBOARD_DIR}`);
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

// ─── Context loader ───────────────────────────────────────────────────────────

/**
 * Reads SOUL.md + USER.md + MEMORY.md from the workspace and returns them
 * as a formatted string ready to be appended to any agent's system prompt.
 */
export function loadWorkspaceContext(): string {
  const parts: string[] = [];

  for (const file of ['SOUL.md', 'USER.md', 'MEMORY.md']) {
    const filePath = path.join(WORKSPACE_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8').trim();
    // Skip placeholder-only MEMORY.md until it has real entries
    if (file === 'MEMORY.md' && content.includes('No entries yet')) continue;
    if (content) {
      parts.push(`### ${file}\n\n${content}`);
    }
  }

  if (parts.length === 0) return '';
  return '\n\n--- LIFOBOARD WORKSPACE ---\n\n' + parts.join('\n\n');
}

// ─── Memory writer ────────────────────────────────────────────────────────────

/**
 * Called by the completion agent after a task finishes.
 * Appends a one-liner to today's daily log and curates MEMORY.md every 10 tasks.
 */
export function writeMemoryEntry(taskTitle: string, changelog: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const dailyFile = path.join(MEMORY_DIR, `${today}.txt`);
  const entry = `[${new Date().toISOString()}] ${taskTitle} — ${changelog}\n`;
  fs.appendFileSync(dailyFile, entry, 'utf8');

  curateMemoryIfNeeded();
}

function curateMemoryIfNeeded(): void {
  if (!fs.existsSync(MEMORY_DIR)) return;

  const dailyFiles = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  let totalLines = 0;
  for (const f of dailyFiles) {
    const lines = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8')
      .split('\n').filter(l => l.trim());
    totalLines += lines.length;
  }

  // Curate on every 10th completed task
  if (totalLines === 0 || totalLines % 10 !== 0) return;

  // Collect the last 20 entries from recent daily files
  const recent: string[] = [];
  for (const f of dailyFiles.slice(-3)) {
    const lines = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8')
      .split('\n').filter(l => l.trim());
    recent.push(...lines);
  }
  const last20 = recent.slice(-20);

  const memoryMd   = path.join(WORKSPACE_DIR, 'MEMORY.md');
  const existing   = fs.existsSync(memoryMd) ? fs.readFileSync(memoryMd, 'utf8') : '';
  const dateStamp  = new Date().toISOString().slice(0, 10);

  const section =
    `\n\n## Milestone (${dateStamp}) — ${totalLines} tasks completed\n\n` +
    last20.map(l => `- ${l.replace(/^\[.*?\] /, '')}`).join('\n');

  fs.writeFileSync(memoryMd, existing + section, 'utf8');
  console.log(`[lifoboard] MEMORY.md curated at ${totalLines} tasks`);
}

// ─── Default workspace file contents ─────────────────────────────────────────

const SOUL_MD = `# SOUL.md — Lifoboard Agent Identity

You are a Kanban workflow agent for Lifoboard. You orchestrate tasks through a pipeline of planning, implementation, testing, review, and completion.

## Core Values

- Move tasks forward efficiently, not just perfectly
- Be pragmatic: a good plan executed beats a perfect plan delayed
- Surface blockers clearly; never silently fail
- Remember past work and build on it — use memory to avoid repeating mistakes
- Keep outputs concise and structured; no filler

## Behaviour

- Reference prior completed work (from MEMORY.md) when it's relevant to the current task
- When uncertain between approving and rejecting, lean toward approval with clear feedback
- Each agent owns exactly one responsibility — don't overreach
- Write memory entries that future agents will actually find useful
`;

const USER_MD = `# USER.md — About the Owner

- **Name:** (set during onboarding)
- **Timezone:** (set during onboarding)
- **Notes:** (add project-specific context here)

## Project Context

Add any context that agents should always have when working on tasks in this board — e.g. tech stack, conventions, what "done" means for this project, team preferences.

---

_Edit this file directly in ~/.lifoboard/workspace/USER.md to give agents better context._
`;

const IDENTITY_MD = `# IDENTITY.md — Who Am I?

- **Name:** Lifoboard
- **Role:** Kanban workflow orchestrator
- **Vibe:** Focused, direct, gets things done without ceremony

## Agent Roster

| Agent      | Triggers on | Moves to    | Responsibility                        |
|------------|-------------|-------------|---------------------------------------|
| planning   | assigned    | in_progress | Break task into concrete steps        |
| progress   | in_progress | testing     | Generate implementation based on plan |
| testing    | testing     | review      | Validate implementation               |
| review     | review      | done        | Approve or reject with feedback       |
| completion | done        | done        | Write changelog + update memory       |
`;

const AGENTS_MD = `# AGENTS.md — Agent Behaviour

## Every Agent Run

Agents load workspace context (SOUL.md + USER.md + MEMORY.md) and inject it into their system prompt, giving every agent a shared understanding of the project and past work.

## Memory Rules

- **Daily logs:** ~/.lifoboard/memory/YYYY-MM-DD.txt — one line per completed task
- **Long-term:** ~/.lifoboard/workspace/MEMORY.md — curated every 10 tasks

## Editing Workspace

Edit files in ~/.lifoboard/workspace/ directly. Changes take effect on the next agent run.
`;

const MEMORY_MD = `# MEMORY.md — Long-term Memory

_Updated automatically by the completion agent every 10 completed tasks._

_(No entries yet — this file grows as tasks are completed.)_
`;

const CONFIG_JSON = JSON.stringify({
  meta: { version: '1.0.0', createdAt: new Date().toISOString() },
  agents: { defaults: { model: 'anthropic/claude-sonnet-4-5' } },
}, null, 2) + '\n';
