import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, KanbanTask, CompletionOutput } from '../types.js';
import { loadSkills } from '../skill-loader.js';
import { callLLM, stripCodeFences } from '../../llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const config: AgentConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
);

const skills = loadSkills(__dirname);

const SYSTEM_PROMPT = `You are a completion agent for a Kanban task management system.

Your job is to generate a changelog entry and document what was accomplished for a completed task.

You MUST respond with valid JSON matching this schema:
{
  "changelog": "A concise, user-facing changelog entry (1-2 sentences)",
  "docsUpdated": ["List of docs or areas that were updated/affected"]
}

Rules:
- Write the changelog entry as if for a release notes document
- Be concise and user-facing (not developer-facing)
- List any documentation or system areas that were affected
- Respond ONLY with the JSON object, no markdown fences or extra text
${skills}`;

export async function handle(task: KanbanTask, taskPath: string, apiKey: string): Promise<void> {
  // Skip if completion already done (avoid re-running on the same task)
  if (task.metadata?.completion) {
    console.log(`[completion] task ${task.id}: already completed, skipping`);
    return;
  }

  task.activity.push({
    type: 'agent_started',
    message: `Completion agent started`,
    by: config.name,
    timestamp: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

  try {
    const planContext = task.metadata?.plan
      ? `\n\nPlan: ${task.metadata.plan.summary}`
      : '';
    const implContext = task.metadata?.implementation
      ? `\n\nImplementation: ${task.metadata.implementation.summary}`
      : '';
    const reviewContext = task.metadata?.review
      ? `\n\nReview: ${task.metadata.review.summary}`
      : '';

    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || '(no description)'}${planContext}${implContext}${reviewContext}`;
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      apiKey,
    });

    const completion: CompletionOutput = {
      ...JSON.parse(stripCodeFences(result)),
      generatedAt: new Date().toISOString(),
    };

    if (!task.metadata) task.metadata = {};
    task.metadata.completion = completion;
    // Status stays in 'done' — no transition
    task.activity.push({
      type: 'agent_output',
      message: `Completion: ${completion.changelog}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    console.log(`[completion] task ${task.id}: changelog generated`);
  } catch (err) {
    task.activity.push({
      type: 'agent_error',
      message: `Completion agent error: ${err instanceof Error ? err.message : String(err)}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    throw err;
  }
}
