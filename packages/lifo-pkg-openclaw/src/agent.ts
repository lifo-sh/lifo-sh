import type {
  AgentConfig,
  AgentTool,
  AgentEventHandler,
  TokenUsage,
  ContentBlock,
  Message,
  AgentContext,
} from './types.js';
import { SessionManager } from './session.js';

// ─── LLM Provider Adapters ───

interface LlmRequest {
  model: string;
  messages: Array<{ role: string; content: string | ContentBlock[] }>;
  system?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
}

interface LlmResponse {
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(config: AgentConfig, request: LlmRequest): Promise<LlmResponse> {
  const baseUrl = config.baseUrl || 'https://api.anthropic.com';

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature ?? 0,
  };

  if (request.system) {
    body.system = request.system;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    content: ContentBlock[];
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content,
    stop_reason: data.stop_reason,
    usage: data.usage,
  };
}

async function callOpenAI(config: AgentConfig, request: LlmRequest): Promise<LlmResponse> {
  const baseUrl = config.baseUrl || 'https://api.openai.com';

  // Convert Anthropic-style messages to OpenAI format
  const messages: Array<Record<string, unknown>> = [];

  if (request.system) {
    messages.push({ role: 'system', content: request.system });
  }

  for (const msg of request.messages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature ?? 0,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  const content: ContentBlock[] = [];

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    content,
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason,
    usage: {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    },
  };
}

async function callLlm(config: AgentConfig, request: LlmRequest): Promise<LlmResponse> {
  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(config, request);
    case 'openai':
      return callOpenAI(config, request);
    case 'openrouter':
      return callOpenAI(
        { ...config, baseUrl: config.baseUrl || 'https://openrouter.ai/api' },
        request,
      );
    default:
      // Default to Anthropic format
      return callAnthropic(config, request);
  }
}

// ─── Agent Runner ───

export class AgentRunner {
  private config: AgentConfig;
  private tools: AgentTool[];
  private sessions: SessionManager;
  private sessionId: string;

  constructor(
    config: AgentConfig,
    tools: AgentTool[],
    sessions: SessionManager,
    sessionId?: string,
  ) {
    this.config = config;
    this.tools = tools;
    this.sessions = sessions;
    this.sessionId = sessionId || sessions.getOrCreateSession(config.model, config.provider);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Send a user message and run the agent loop.
   * The agent will call tools as needed until it produces a final text response.
   */
  async run(
    userMessage: string,
    events?: AgentEventHandler,
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }> {
    // Append user message to session
    this.sessions.appendMessage(this.sessionId, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let iterations = 0;
    const maxIterations = this.config.maxIterations || 100;

    // Build conversation messages from session history
    const messages = this.sessions.toApiMessages(this.sessionId);

    // Build tools spec for LLM
    const toolSpecs = this.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    while (iterations < maxIterations) {
      if (signal?.aborted) {
        throw new Error('Agent run aborted');
      }

      iterations++;

      // Call LLM
      const response = await callLlm(this.config, {
        model: this.config.model,
        messages,
        system: this.config.systemPrompt,
        tools: toolSpecs,
        max_tokens: this.config.maxTokens || 8192,
        temperature: this.config.temperature,
      });

      // Track usage
      totalUsage.inputTokens += response.usage.input_tokens;
      totalUsage.outputTokens += response.usage.output_tokens;
      totalUsage.totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      // Extract text and tool calls from response
      const textBlocks: string[] = [];
      const toolCalls: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textBlocks.push(block.text);
          events?.onPartialReply?.(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push(block);
        }
      }

      // Store assistant response in session
      this.sessions.appendMessage(this.sessionId, {
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      });

      // Add assistant message to conversation
      messages.push({ role: 'assistant', content: response.content });

      // If no tool calls, we're done
      if (response.stop_reason !== 'tool_use' || toolCalls.length === 0) {
        const finalText = textBlocks.join('');
        this.sessions.updateTokens(this.sessionId, totalUsage.totalTokens);
        events?.onComplete?.(finalText, totalUsage);
        return { text: finalText, usage: totalUsage };
      }

      // Execute tool calls
      const toolResults: ContentBlock[] = [];

      for (const tc of toolCalls) {
        events?.onToolStart?.(tc.name, tc.input);

        const tool = this.tools.find(t => t.name === tc.name);
        let resultContent: string;

        if (!tool) {
          resultContent = `Error: Unknown tool "${tc.name}"`;
        } else {
          try {
            const result = await tool.execute(tc.input);
            events?.onToolResult?.(tc.name, result);

            resultContent = result.content
              .map(c => {
                if (c.type === 'text') return c.text;
                if (c.type === 'error') return `Error: ${c.message}`;
                return '[non-text content]';
              })
              .join('\n');
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            resultContent = `Tool execution error: ${errMsg}`;
            events?.onError?.(e instanceof Error ? e : new Error(errMsg));
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: resultContent,
        });
      }

      // Store tool results in session
      this.sessions.appendMessage(this.sessionId, {
        role: 'user',
        content: toolResults,
        timestamp: Date.now(),
      });

      // Add tool results to conversation
      messages.push({ role: 'user', content: toolResults });
    }

    // Exceeded max iterations
    const errorMsg = `Agent exceeded maximum iterations (${maxIterations})`;
    events?.onError?.(new Error(errorMsg));
    return { text: errorMsg, usage: totalUsage };
  }
}
