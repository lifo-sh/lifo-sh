import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, KanbanTask, TestOutput } from '../types.js';
import { loadSkills } from '../skill-loader.js';
import { callLLM, stripCodeFences } from '../../llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const config: AgentConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
);

const skills = loadSkills(__dirname);

const SYSTEM_PROMPT = `You are a testing agent for a Kanban task management system.

Your job is to validate the implementation of a task and report any issues found.

You MUST respond with valid JSON matching this schema:
{
  "passed": true | false,
  "summary": "Brief summary of test results",
  "issues": ["Issue 1 description", ...] // empty array if all passed
}

Rules:
- Review the plan and implementation
- Check for completeness, correctness, and edge cases
- Be thorough but pragmatic
- Respond ONLY with the JSON object, no markdown fences or extra text
${skills}`;

export async function handle(task: KanbanTask, taskPath: string, apiKey: string): Promise<void> {
  task.activity.push({
    type: 'agent_started',
    message: `Testing agent started`,
    by: config.name,
    timestamp: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

  try {
    const planContext = task.metadata?.plan
      ? `\n\nPlan:\n${task.metadata.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';
    const implContext = task.metadata?.implementation
      ? `\n\nImplementation:\n${task.metadata.implementation.summary}\nChanges:\n${task.metadata.implementation.changes.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';

    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || '(no description)'}${planContext}${implContext}`;
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      apiKey,
      model: config.model,
    });

    const testResults: TestOutput = {
      ...JSON.parse(stripCodeFences(result)),
      generatedAt: new Date().toISOString(),
    };

    if (!task.metadata) task.metadata = {};
    task.metadata.testResults = testResults;
    task.status = config.targetStatus;
    task.activity.push({
      type: 'agent_output',
      message: `Testing ${testResults.passed ? 'PASSED' : 'FAILED'}: ${testResults.summary}${testResults.issues.length ? ` (${testResults.issues.length} issues)` : ''}`,
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
    console.log(`[testing] task ${task.id}: tests ${testResults.passed ? 'passed' : 'failed'}, moved to ${config.targetStatus}`);
  } catch (err) {
    task.activity.push({
      type: 'agent_error',
      message: `Testing agent error: ${err instanceof Error ? err.message : String(err)}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    throw err;
  }
}
