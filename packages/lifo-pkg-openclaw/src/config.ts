import type { VFS } from '@lifo-sh/core';
import type { AgentConfig } from './types.js';

const CONFIG_DIR = '/home/user/.openclaw';
const CONFIG_FILE = '/home/user/.openclaw/config.json';
const DEFAULT_WORKSPACE = '/home/user/workspace';

export function ensureConfigDirs(vfs: VFS): void {
  const dirs = [
    CONFIG_DIR,
    `${CONFIG_DIR}/sessions`,
    `${CONFIG_DIR}/memory`,
    DEFAULT_WORKSPACE,
  ];
  for (const dir of dirs) {
    try { vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  }
}

export function loadConfig(vfs: VFS, env: Record<string, string>): AgentConfig {
  ensureConfigDirs(vfs);

  // Try to load from VFS config file
  let config: Partial<AgentConfig> = {};
  try {
    const raw = vfs.readFileString(CONFIG_FILE);
    config = JSON.parse(raw);
  } catch {
    // No config file yet — use defaults
  }

  // Resolve API key from config or env
  const provider = config.provider || env.OPENCLAW_PROVIDER || 'anthropic';
  let apiKey = config.apiKey || '';

  if (!apiKey) {
    switch (provider) {
      case 'anthropic':
        apiKey = env.ANTHROPIC_API_KEY || '';
        break;
      case 'openai':
        apiKey = env.OPENAI_API_KEY || '';
        break;
      case 'google':
        apiKey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '';
        break;
      default:
        apiKey = env[`${provider.toUpperCase()}_API_KEY`] || '';
    }
  }

  // Resolve model
  const model = config.model || env.OPENCLAW_MODEL || resolveDefaultModel(provider);

  return {
    provider,
    model,
    apiKey,
    baseUrl: config.baseUrl || env.OPENCLAW_BASE_URL,
    displayName: config.displayName || 'OpenClaw Agent',
    systemPrompt: config.systemPrompt || loadSystemPrompt(vfs),
    maxTokens: config.maxTokens || 8192,
    temperature: config.temperature ?? 0,
    workspaceDir: config.workspaceDir || DEFAULT_WORKSPACE,
    maxIterations: config.maxIterations || 100,
  };
}

export function saveConfig(vfs: VFS, config: AgentConfig): void {
  ensureConfigDirs(vfs);
  vfs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function resolveDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-5-20250514';
    case 'openai': return 'gpt-4o';
    case 'google': return 'gemini-2.0-flash';
    default: return 'claude-sonnet-4-5-20250514';
  }
}

function loadSystemPrompt(vfs: VFS): string {
  // Try to load IDENTITY.md from workspace
  const identityPaths = [
    '/home/user/workspace/IDENTITY.md',
    '/home/user/.openclaw/IDENTITY.md',
  ];

  for (const path of identityPaths) {
    try {
      return vfs.readFileString(path);
    } catch {
      // Not found, continue
    }
  }

  return `You are a helpful AI assistant running in Lifo, a browser-based operating system. You have access to a virtual filesystem and shell. You can read and write files, execute shell commands, and help users with coding and system tasks.

Available tools:
- read: Read files from the filesystem
- write: Create or overwrite files
- edit: Make targeted edits to existing files
- exec: Execute shell commands
- web_fetch: Fetch content from URLs

When working with files, always use absolute paths starting from /home/user/.`;
}
