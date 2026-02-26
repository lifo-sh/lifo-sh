import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, KanbanTask, ReviewOutput } from '../types.js';
import { loadSkills } from '../skill-loader.js';
import { callLLM, stripCodeFences } from '../../llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const config: AgentConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
);

const skills = loadSkills(__dirname);

const SYSTEM_PROMPT = `You are a review agent for a Kanban task management system.

Your job is to review the implementation and test results, then approve or reject the task.

You MUST respond with valid JSON matching this schema:
{
  "approved": true | false,
  "summary": "Brief review summary",
  "feedback": ["Feedback point 1", ...]
}

Rules:
- Review the plan, implementation, and test results holistically
- Approve if the implementation meets the plan requirements and tests pass
- Reject with clear, actionable feedback if improvements are needed
- Be pragmatic — don't reject for minor issues
- Respond ONLY with the JSON object, no markdown fences or extra text
${skills}`;

export async function handle(task: KanbanTask, taskPath: string, apiKey: string): Promise<void> {
  task.activity.push({
    type: 'agent_started',
    message: `Review agent started`,
    by: config.name,
    timestamp: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

  try {
    const planContext = task.metadata?.plan
      ? `\n\nPlan:\n- Summary: ${task.metadata.plan.summary}\n- Steps:\n${task.metadata.plan.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
      : '';
    const implContext = task.metadata?.implementation
      ? `\n\nImplementation:\n- Summary: ${task.metadata.implementation.summary}\n- Changes:\n${task.metadata.implementation.changes.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
      : '';
    const testContext = task.metadata?.testResults
      ? `\n\nTest Results:\n- Passed: ${task.metadata.testResults.passed}\n- Summary: ${task.metadata.testResults.summary}${task.metadata.testResults.issues.length ? `\n- Issues:\n${task.metadata.testResults.issues.map((iss, i) => `  ${i + 1}. ${iss}`).join('\n')}` : ''}`
      : '';

    // Check loop limit
    const edgeKey = `review→${config.rejectTarget}`;
    const transitionCount = task.transition_count?.[edgeKey] || 0;
    const loopWarning = transitionCount >= 2
      ? `\n\nIMPORTANT: This task has already been rejected ${transitionCount} time(s). You MUST approve it this time to prevent infinite loops. Note any remaining concerns in your feedback but set approved to true.`
      : '';

    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || '(no description)'}${planContext}${implContext}${testContext}${loopWarning}`;
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      apiKey,
      model: config.model,
    });

    const review: ReviewOutput = {
      ...JSON.parse(stripCodeFences(result)),
      generatedAt: new Date().toISOString(),
    };

    if (!task.metadata) task.metadata = {};
    task.metadata.review = review;

    // Track transitions for loop prevention
    if (!task.transition_count) task.transition_count = {};

    if (review.approved) {
      task.status = config.targetStatus;
      task.activity.push({
        type: 'agent_output',
        message: `Review APPROVED: ${review.summary}`,
        by: config.name,
        timestamp: new Date().toISOString(),
      });
      task.activity.push({
        type: 'status_changed',
        message: `Status changed from ${config.triggerStatus} to ${config.targetStatus}`,
        by: config.name,
        timestamp: new Date().toISOString(),
      });
    } else {
      const rejectTarget = config.rejectTarget || 'in_progress';
      task.status = rejectTarget;
      task.transition_count[edgeKey] = transitionCount + 1;
      task.activity.push({
        type: 'agent_output',
        message: `Review REJECTED: ${review.summary}. Feedback: ${review.feedback.join('; ')}`,
        by: config.name,
        timestamp: new Date().toISOString(),
      });
      task.activity.push({
        type: 'status_changed',
        message: `Status changed from ${config.triggerStatus} to ${rejectTarget} (rejection #${transitionCount + 1})`,
        by: config.name,
        timestamp: new Date().toISOString(),
      });
    }

    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    console.log(`[review] task ${task.id}: ${review.approved ? 'approved' : 'rejected'}`);
  } catch (err) {
    task.activity.push({
      type: 'agent_error',
      message: `Review agent error: ${err instanceof Error ? err.message : String(err)}`,
      by: config.name,
      timestamp: new Date().toISOString(),
    });
    task.updated_at = new Date().toISOString();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    throw err;
  }
}
