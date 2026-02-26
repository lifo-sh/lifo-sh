import type { VFS, CommandContext } from '@lifo-sh/core';

// ─── Agent Config ───

export interface AgentConfig {
  /** LLM provider: "anthropic" | "openai" | "google" */
  provider: string;
  /** Model ID, e.g. "claude-sonnet-4-5-20250514" */
  model: string;
  /** API key for the provider */
  apiKey: string;
  /** Base URL override for the API */
  baseUrl?: string;
  /** Agent display name */
  displayName?: string;
  /** System prompt / identity */
  systemPrompt?: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Workspace directory in VFS */
  workspaceDir?: string;
  /** Max tool execution iterations per turn */
  maxIterations?: number;
}

// ─── Tool Types (compatible with OpenClaw/PI SDK tool interface) ───

export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'error'; message: string }
  >;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// ─── Message Types ───

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: 'text'; text: string }> };

// ─── Session Types ───

export interface SessionEntry {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  timestamp: number;
}

export interface SessionMetadata {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  provider: string;
  totalTokens: number;
  messageCount: number;
}

// ─── Agent Events (for streaming UI updates) ───

export interface AgentEventHandler {
  onPartialReply?: (text: string) => void;
  onToolStart?: (name: string, params: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  onError?: (error: Error) => void;
  onComplete?: (text: string, usage: TokenUsage) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── Agent Context (passed to tools) ───

export interface AgentContext {
  vfs: VFS;
  cwd: string;
  env: Record<string, string>;
  executeShell: (cmd: string) => Promise<string>;
}
