import type { Command, CommandContext } from '@lifo-sh/core';
import { resolve } from '@lifo-sh/core';
import { loadConfig, saveConfig, ensureConfigDirs } from './config.js';
import { SessionManager } from './session.js';
import { AgentRunner } from './agent.js';
import { createTools } from './tools.js';
import type { AgentContext, AgentEventHandler } from './types.js';

export type { AgentConfig, AgentTool, ToolResult, AgentContext, AgentEventHandler, TokenUsage } from './types.js';
export { AgentRunner } from './agent.js';
export { SessionManager } from './session.js';
export { createTools } from './tools.js';
export { loadConfig, saveConfig } from './config.js';

const USAGE = `usage: openclaw <command> [args]

Commands:
  chat <message>     Send a message to the agent
  run <message>      Same as chat (alias)
  config             Show current configuration
  config set <k> <v> Set a configuration value
  sessions           List all sessions
  session new        Start a new session
  session clear      Clear current session history
  status             Show agent status
  help               Show this help

Environment variables:
  ANTHROPIC_API_KEY   Anthropic API key
  OPENAI_API_KEY      OpenAI API key
  OPENCLAW_MODEL      Model to use (default: claude-sonnet-4-5-20250514)
  OPENCLAW_PROVIDER   Provider to use (default: anthropic)
`;

function createAgentContext(
  ctx: CommandContext,
  executeCapture?: (cmd: string) => Promise<string>,
): AgentContext {
  return {
    vfs: ctx.vfs,
    cwd: ctx.cwd,
    env: ctx.env,
    executeShell: async (cmd: string) => {
      if (executeCapture) {
        return executeCapture(cmd);
      }
      // Fallback: simulate basic commands using VFS directly
      throw new Error(
        'Shell execution not available in this context. ' +
        'Use read/write/edit tools for file operations instead.'
      );
    },
  };
}

// ─── Subcommands ───

async function handleChat(
  ctx: CommandContext,
  message: string,
  agentCtx: AgentContext,
): Promise<number> {
  const config = loadConfig(ctx.vfs, ctx.env);

  if (!config.apiKey) {
    ctx.stderr.write(
      'Error: No API key configured.\n' +
      'Set ANTHROPIC_API_KEY environment variable or run:\n' +
      '  openclaw config set apiKey <your-key>\n'
    );
    return 1;
  }

  const sessions = new SessionManager(ctx.vfs);
  const tools = createTools(agentCtx);
  const runner = new AgentRunner(config, tools, sessions);

  ctx.stdout.write('\x1b[90mThinking...\x1b[0m\n');

  const events: AgentEventHandler = {
    onToolStart(name, params) {
      const paramStr = Object.keys(params).length > 0
        ? ` ${JSON.stringify(params).slice(0, 80)}`
        : '';
      ctx.stdout.write(`\x1b[36m> ${name}${paramStr}\x1b[0m\n`);
    },
    onToolResult(name, result) {
      const preview = result.content
        .map(c => c.type === 'text' ? c.text.slice(0, 100) : c.type)
        .join(', ');
      ctx.stdout.write(`\x1b[90m  ${name} → ${preview}${preview.length >= 100 ? '...' : ''}\x1b[0m\n`);
    },
    onError(error) {
      ctx.stderr.write(`\x1b[31mError: ${error.message}\x1b[0m\n`);
    },
  };

  try {
    const result = await runner.run(message, events, ctx.signal);

    ctx.stdout.write('\n');
    ctx.stdout.write(result.text);
    ctx.stdout.write('\n');
    ctx.stdout.write(
      `\x1b[90m(${result.usage.inputTokens} in / ${result.usage.outputTokens} out)\x1b[0m\n`
    );
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.stderr.write(`\x1b[31mAgent error: ${msg}\x1b[0m\n`);
    return 1;
  }
}

function handleConfig(ctx: CommandContext): number {
  const config = loadConfig(ctx.vfs, ctx.env);
  const args = ctx.args.slice(1); // skip "config"

  if (args[0] === 'set' && args.length >= 3) {
    const key = args[1];
    const value = args.slice(2).join(' ');

    const validKeys = ['provider', 'model', 'apiKey', 'baseUrl', 'displayName', 'maxTokens', 'temperature', 'workspaceDir', 'maxIterations'];
    if (!validKeys.includes(key)) {
      ctx.stderr.write(`Unknown config key: ${key}\nValid keys: ${validKeys.join(', ')}\n`);
      return 1;
    }

    const updated = { ...config, [key]: value };
    // Convert numeric fields
    if (key === 'maxTokens' || key === 'maxIterations') {
      (updated as Record<string, unknown>)[key] = parseInt(value, 10);
    }
    if (key === 'temperature') {
      (updated as Record<string, unknown>)[key] = parseFloat(value);
    }

    saveConfig(ctx.vfs, updated);
    ctx.stdout.write(`Set ${key} = ${value}\n`);
    return 0;
  }

  // Show config (hide API key)
  const display = { ...config };
  if (display.apiKey) {
    display.apiKey = display.apiKey.slice(0, 8) + '...' + display.apiKey.slice(-4);
  }
  ctx.stdout.write(JSON.stringify(display, null, 2) + '\n');
  return 0;
}

function handleSessions(ctx: CommandContext): number {
  const sessions = new SessionManager(ctx.vfs);
  const args = ctx.args.slice(1);

  if (args[0] === 'new') {
    const config = loadConfig(ctx.vfs, ctx.env);
    const id = sessions.createSession(config.model, config.provider);
    ctx.stdout.write(`Created new session: ${id}\n`);
    return 0;
  }

  if (args[0] === 'clear') {
    const list = sessions.listSessions();
    if (list.length > 0) {
      sessions.clearSession(list[0].sessionId);
      ctx.stdout.write(`Cleared session: ${list[0].sessionId}\n`);
    } else {
      ctx.stdout.write('No sessions to clear.\n');
    }
    return 0;
  }

  // List sessions
  const list = sessions.listSessions();
  if (list.length === 0) {
    ctx.stdout.write('No sessions.\n');
    return 0;
  }

  for (const s of list) {
    const date = new Date(s.updatedAt).toLocaleString();
    ctx.stdout.write(
      `${s.sessionId.slice(0, 8)}  ${s.model}  ${s.messageCount} msgs  ${s.totalTokens} tokens  ${date}\n`
    );
  }
  return 0;
}

function handleStatus(ctx: CommandContext): number {
  const config = loadConfig(ctx.vfs, ctx.env);
  const sessions = new SessionManager(ctx.vfs);
  const list = sessions.listSessions();

  ctx.stdout.write('OpenClaw on Lifo\n');
  ctx.stdout.write('─────────────────\n');
  ctx.stdout.write(`Provider:   ${config.provider}\n`);
  ctx.stdout.write(`Model:      ${config.model}\n`);
  ctx.stdout.write(`API Key:    ${config.apiKey ? 'configured' : 'NOT SET'}\n`);
  ctx.stdout.write(`Sessions:   ${list.length}\n`);
  ctx.stdout.write(`Workspace:  ${config.workspaceDir}\n`);
  return 0;
}

// ─── Main Command Entry ───

const openclawCommand: Command = async (ctx) => {
  const subcmd = ctx.args[0];

  if (!subcmd || subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
    ctx.stdout.write(USAGE);
    return 0;
  }

  ensureConfigDirs(ctx.vfs);

  // The executeCapture function is injected if available (e.g. from Sandbox)
  const executeCapture = (ctx as unknown as { executeCapture?: (cmd: string) => Promise<string> }).executeCapture;
  const agentCtx = createAgentContext(ctx, executeCapture);

  switch (subcmd) {
    case 'chat':
    case 'run': {
      const message = ctx.args.slice(1).join(' ');
      if (!message.trim()) {
        ctx.stderr.write('Usage: openclaw chat <message>\n');
        return 1;
      }
      return handleChat(ctx, message, agentCtx);
    }
    case 'config':
      return handleConfig(ctx);
    case 'sessions':
    case 'session':
      return handleSessions(ctx);
    case 'status':
      return handleStatus(ctx);
    default: {
      // Treat everything after 'openclaw' as a chat message
      const message = ctx.args.join(' ');
      return handleChat(ctx, message, agentCtx);
    }
  }
};

export default openclawCommand;
