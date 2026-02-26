export interface KanbanActivity {
  type: 'created' | 'status_changed' | 'assigned' | 'note' | 'updated'
      | 'agent_started' | 'agent_output' | 'agent_error';
  message: string;
  by: string;
  timestamp: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  assignee_type: 'human' | 'agent' | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deliverables: unknown[];
  activity: KanbanActivity[];
  metadata?: {
    plan?: PlanOutput;
    implementation?: ImplementationOutput;
    testResults?: TestOutput;
    review?: ReviewOutput;
    completion?: CompletionOutput;
  };
  transition_count?: Record<string, number>;
  pipeline?: string[];   // optional custom status route, e.g. ["assigned","in_progress","done"]
}

export interface PlanOutput {
  summary: string;
  steps: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  generatedAt: string;
}

export interface ImplementationOutput {
  summary: string;
  changes: string[];
  generatedAt: string;
}

export interface TestOutput {
  passed: boolean;
  summary: string;
  issues: string[];
  generatedAt: string;
}

export interface ReviewOutput {
  approved: boolean;
  summary: string;
  feedback: string[];
  generatedAt: string;
}

export interface CompletionOutput {
  changelog: string;
  docsUpdated: string[];
  generatedAt: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  triggerStatus: string;
  targetStatus: string;
  rejectTarget?: string;
  model?: string;
}

export interface AgentModule {
  config: AgentConfig;
  handle: (task: KanbanTask, taskPath: string, apiKey: string) => Promise<void>;
}
