import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, KanbanTask, ImplementationOutput } from '../types.js';
import { loadSkills } from '../skill-loader.js';
import { callLLM, stripCodeFences } from '../../llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const config: AgentConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
);

const skills = loadSkills(__dirname);

const SYSTEM_PROMPT = `You are an implementation agent for a Kanban task management system.

Your job is to generate an implementation based on the task and its plan.

You MUST respond with valid JSON matching this schema:
{
  "summary": "Brief summary of what was implemented",
  "changes": ["Change 1 description", "Change 2 description", ...]
}

Rules:
- Reference the plan steps when describing changes
- Be specific about what was implemented
- Respond ONLY with the JSON object, no markdown fences or extra text
${skills}`;

export async function handle(task: KanbanTask, taskPath: string, apiKey: string): Promise<void> {
  task.activity.push({
    type: 'agent_started',
    message: `Progress agent started`,
    by: config.name,
    timestamp: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

  try {
    const planContext = task.metadata?.plan
      ? `\n\nPlan:\n${task.metadata.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || '(no description)'}${planContext}`;
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      apiKey,
      model: config.model,
    });

    const implementation: ImplementationOutput = {
      ...JSON.parse(stripCodeFences(result)),
      generatedAt: new Date().toISOString(),
    };

    if (!task.metadata) task.metadata = {};
    task.metadata.implementation = implementation;
    task.status = config.targetStatus;
    task.activity.push({
      type: 'agent_output',
      message: `Implementation complete: ${implementation.summary} (${implementation.changes.length} changes)`,
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
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    console.log(`[progress] task ${task.id}: implementation done, moved to ${config.targetStatus}`);
  } catch (err) {
    task.activity.push({
      type: 'agent_error',
      message: `Progress agent error: ${err instanceof Error ? err.message : String(err)}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    throw err;
  }
}
