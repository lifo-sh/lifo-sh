import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, KanbanTask, PlanOutput } from '../types.js';
import { loadSkills } from '../skill-loader.js';
import { callLLM, stripCodeFences } from '../../llm.js';
import { loadWorkspaceContext } from '../../lifoboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const config: AgentConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
);

const skills = loadSkills(__dirname);
const workspaceContext = loadWorkspaceContext();

const SYSTEM_PROMPT = `You are a planning agent for a Kanban task management system.

Your job is to take a task and break it down into a clear, actionable plan.

You MUST respond with valid JSON matching this schema:
{
  "summary": "Brief summary of the plan",
  "steps": ["Step 1 description", "Step 2 description", ...],
  "estimatedComplexity": "low" | "medium" | "high"
}

Rules:
- Keep steps concrete and actionable
- 3-7 steps is ideal
- Each step should be completable independently
- Respond ONLY with the JSON object, no markdown fences or extra text
${skills}${workspaceContext}`;

export async function handle(task: KanbanTask, taskPath: string, apiKey: string): Promise<void> {
  // 1. Add agent_started activity
  task.activity.push({
    type: 'agent_started',
    message: `Planning agent started`,
    by: config.name,
    timestamp: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

  try {
    // 2. Load project memory (last 5 completed tasks for context)
    let memoryContext = '';
    try {
      const memoryDir = path.resolve(__dirname, '../../../data/memory');
      if (fs.existsSync(memoryDir)) {
        const files = fs.readdirSync(memoryDir)
          .filter(f => f.endsWith('.txt'))
          .map(f => ({ f, mtime: fs.statSync(path.join(memoryDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 5)
          .map(({ f }) => fs.readFileSync(path.join(memoryDir, f), 'utf8').trim());
        if (files.length > 0) {
          memoryContext = `\n\nRecent completed work in this project:\n${files.map(l => `- ${l}`).join('\n')}`;
        }
      }
    } catch { /* memory is optional — never fail planning because of it */ }

    // 3. Call LLM
    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || '(no description provided)'}${memoryContext}`;
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      apiKey,
      model: config.model,
    });

    // 3. Parse result
    const plan: PlanOutput = {
      ...JSON.parse(stripCodeFences(result)),
      generatedAt: new Date().toISOString(),
    };

    // 4. Write plan to task metadata + move to target status
    if (!task.metadata) task.metadata = {};
    task.metadata.plan = plan;
    task.status = config.targetStatus;
    task.assignee = config.name;
    task.assignee_type = 'agent';
    task.activity.push({
      type: 'agent_output',
      message: `Plan created: ${plan.summary} (${plan.steps.length} steps, complexity: ${plan.estimatedComplexity})`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.activity.push({
      type: 'status_changed',
      message: `Status changed from ${config.triggerStatus} to ${config.targetStatus}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();

    // 5. Single write triggers chokidar → next agent
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    console.log(`[planning] task ${task.id}: plan created, moved to ${config.targetStatus}`);
  } catch (err) {
    // Error: write activity but do NOT change status
    task.activity.push({
      type: 'agent_error',
      message: `Planning agent error: ${err instanceof Error ? err.message : String(err)}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    throw err;
  }
}
