import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VFS } from '@lifo-sh/core';
import type { CommandContext } from '@lifo-sh/core';
import openclawCommand from '../src/index.js';
import { SessionManager } from '../src/session.js';
import { loadConfig, saveConfig, ensureConfigDirs } from '../src/config.js';
import { createTools } from '../src/tools.js';
import { AgentRunner } from '../src/agent.js';
import type { AgentContext, AgentConfig, AgentEventHandler } from '../src/types.js';

// ─── Test Helpers ───

function makeCtx(
  vfs: VFS,
  args: string[],
  cwd = '/home/user',
  env: Record<string, string> = {},
): CommandContext & { out: string; err: string } {
  const result = {
    args,
    env: {
      HOME: '/home/user',
      USER: 'user',
      ...env,
    },
    cwd,
    vfs,
    stdout: { write(text: string) { result.out += text; } },
    stderr: { write(text: string) { result.err += text; } },
    signal: new AbortController().signal,
    out: '',
    err: '',
  };
  return result;
}

function makeAgentContext(vfs: VFS, cwd = '/home/user/workspace'): AgentContext {
  return {
    vfs,
    cwd,
    env: { HOME: '/home/user', USER: 'user' },
    executeShell: async () => { throw new Error('Shell not available'); },
  };
}

// ─── Phase 4.1: Boot Tests ───

describe('openclaw command boot', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user', { recursive: true });
  });

  it('shows help with no args', async () => {
    const ctx = makeCtx(vfs, []);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('usage: openclaw');
    expect(ctx.out).toContain('chat');
    expect(ctx.out).toContain('config');
  });

  it('shows help with --help', async () => {
    const ctx = makeCtx(vfs, ['--help']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('usage: openclaw');
  });

  it('shows help with help subcommand', async () => {
    const ctx = makeCtx(vfs, ['help']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('usage: openclaw');
  });

  it('shows status', async () => {
    const ctx = makeCtx(vfs, ['status'], '/home/user', {
      ANTHROPIC_API_KEY: 'sk-ant-test123',
    });
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('OpenClaw on Lifo');
    expect(ctx.out).toContain('anthropic');
    expect(ctx.out).toContain('configured');
  });

  it('shows status with no API key', async () => {
    const ctx = makeCtx(vfs, ['status']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('NOT SET');
  });

  it('creates config dirs on any subcommand', async () => {
    const ctx = makeCtx(vfs, ['status']);
    await openclawCommand(ctx);
    expect(vfs.exists('/home/user/.openclaw')).toBe(true);
    expect(vfs.exists('/home/user/.openclaw/sessions')).toBe(true);
    expect(vfs.exists('/home/user/workspace')).toBe(true);
  });

  it('errors on chat with no message', async () => {
    const ctx = makeCtx(vfs, ['chat']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.err).toContain('Usage: openclaw chat');
  });

  it('errors on chat with no API key', async () => {
    const ctx = makeCtx(vfs, ['chat', 'hello']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.err).toContain('No API key');
  });
});

// ─── Phase 4.2: Config Tests ───

describe('config', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user', { recursive: true });
  });

  it('loads default config', () => {
    const config = loadConfig(vfs, {});
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-5-20250514');
    expect(config.apiKey).toBe('');
    expect(config.maxTokens).toBe(8192);
  });

  it('loads API key from env', () => {
    const config = loadConfig(vfs, { ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(config.apiKey).toBe('sk-ant-test');
  });

  it('loads OpenAI key from env', () => {
    const config = loadConfig(vfs, {
      OPENCLAW_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-openai-test',
    });
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-openai-test');
    expect(config.model).toBe('gpt-4o');
  });

  it('respects env model override', () => {
    const config = loadConfig(vfs, { OPENCLAW_MODEL: 'claude-opus-4-20250514' });
    expect(config.model).toBe('claude-opus-4-20250514');
  });

  it('saves and loads config from VFS', () => {
    const config = loadConfig(vfs, {});
    config.apiKey = 'my-key';
    config.model = 'custom-model';
    saveConfig(vfs, config);

    const loaded = loadConfig(vfs, {});
    expect(loaded.apiKey).toBe('my-key');
    expect(loaded.model).toBe('custom-model');
  });

  it('config set command works', async () => {
    const ctx = makeCtx(vfs, ['config', 'set', 'model', 'gpt-4o']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('Set model = gpt-4o');

    const config = loadConfig(vfs, {});
    expect(config.model).toBe('gpt-4o');
  });

  it('config set rejects unknown keys', async () => {
    const ctx = makeCtx(vfs, ['config', 'set', 'unknownKey', 'value']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(1);
    expect(ctx.err).toContain('Unknown config key');
  });

  it('config show displays config', async () => {
    const ctx = makeCtx(vfs, ['config'], '/home/user', {
      ANTHROPIC_API_KEY: 'sk-ant-test12345678',
    });
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.out);
    expect(parsed.provider).toBe('anthropic');
    // API key should be masked
    expect(parsed.apiKey).toContain('...');
    expect(parsed.apiKey).not.toBe('sk-ant-test12345678');
  });

  it('config set handles numeric fields', async () => {
    const ctx = makeCtx(vfs, ['config', 'set', 'maxTokens', '4096']);
    await openclawCommand(ctx);
    const config = loadConfig(vfs, {});
    expect(config.maxTokens).toBe(4096);
  });

  it('loads IDENTITY.md as system prompt', () => {
    vfs.mkdir('/home/user/workspace', { recursive: true });
    vfs.writeFile('/home/user/workspace/IDENTITY.md', 'You are a custom agent.');
    const config = loadConfig(vfs, {});
    expect(config.systemPrompt).toBe('You are a custom agent.');
  });
});

// ─── Phase 4.3: Session Tests ───

describe('SessionManager', () => {
  let vfs: VFS;
  let sessions: SessionManager;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user/.openclaw/sessions', { recursive: true });
    sessions = new SessionManager(vfs);
  });

  it('creates a new session', () => {
    const id = sessions.createSession('claude-sonnet-4-5-20250514', 'anthropic');
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
  });

  it('lists sessions', () => {
    sessions.createSession('claude-sonnet-4-5-20250514', 'anthropic');
    sessions.createSession('gpt-4o', 'openai');
    const list = sessions.listSessions();
    expect(list.length).toBe(2);
  });

  it('getOrCreateSession returns existing session', () => {
    const id1 = sessions.createSession('claude-sonnet-4-5-20250514', 'anthropic');
    const id2 = sessions.getOrCreateSession('claude-sonnet-4-5-20250514', 'anthropic');
    expect(id2).toBe(id1);
  });

  it('getOrCreateSession creates new for different model', () => {
    sessions.createSession('claude-sonnet-4-5-20250514', 'anthropic');
    const id2 = sessions.getOrCreateSession('gpt-4o', 'openai');
    const list = sessions.listSessions();
    expect(list.length).toBe(2);
    expect(list.some(s => s.sessionId === id2)).toBe(true);
  });

  it('appends and loads messages', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    sessions.appendMessage(id, {
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    });
    sessions.appendMessage(id, {
      role: 'assistant',
      content: 'hi there',
      timestamp: Date.now(),
    });

    const messages = sessions.loadMessages(id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('hi there');
  });

  it('converts to API messages', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    sessions.appendMessage(id, { role: 'user', content: 'hello', timestamp: Date.now() });
    sessions.appendMessage(id, { role: 'assistant', content: 'hi', timestamp: Date.now() });

    const apiMsgs = sessions.toApiMessages(id);
    expect(apiMsgs.length).toBe(2);
    expect(apiMsgs[0]).toEqual({ role: 'user', content: 'hello' });
    expect(apiMsgs[1]).toEqual({ role: 'assistant', content: 'hi' });
  });

  it('tracks token usage', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    sessions.updateTokens(id, 100);
    sessions.updateTokens(id, 200);

    const list = sessions.listSessions();
    const meta = list.find(s => s.sessionId === id)!;
    expect(meta.totalTokens).toBe(300);
  });

  it('clears session', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    sessions.appendMessage(id, { role: 'user', content: 'hello', timestamp: Date.now() });
    sessions.clearSession(id);

    const messages = sessions.loadMessages(id);
    expect(messages.length).toBe(0);

    const meta = sessions.listSessions().find(s => s.sessionId === id)!;
    expect(meta.messageCount).toBe(0);
    expect(meta.totalTokens).toBe(0);
  });

  it('deletes session', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    const deleted = sessions.deleteSession(id);
    expect(deleted).toBe(true);
    expect(sessions.listSessions().length).toBe(0);
  });

  it('persists across instances', () => {
    const id = sessions.createSession('test-model', 'anthropic');
    sessions.appendMessage(id, { role: 'user', content: 'persist me', timestamp: Date.now() });

    // Create new SessionManager on same VFS
    const sessions2 = new SessionManager(vfs);
    const list = sessions2.listSessions();
    expect(list.length).toBe(1);
    expect(list[0].sessionId).toBe(id);

    const messages = sessions2.loadMessages(id);
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('persist me');
  });

  it('sessions command lists sessions', async () => {
    // Seed a session
    ensureConfigDirs(vfs);
    const sm = new SessionManager(vfs);
    sm.createSession('claude-sonnet-4-5-20250514', 'anthropic');

    const ctx = makeCtx(vfs, ['sessions']);
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('claude-sonnet-4-5-20250514');
  });

  it('session new creates a session', async () => {
    const ctx = makeCtx(vfs, ['session', 'new'], '/home/user', {
      ANTHROPIC_API_KEY: 'sk-test',
    });
    const code = await openclawCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.out).toContain('Created new session');
  });
});

// ─── Phase 4.4: Tool Tests ───

describe('tools', () => {
  let vfs: VFS;
  let agentCtx: AgentContext;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user/workspace', { recursive: true });
    agentCtx = makeAgentContext(vfs);
  });

  describe('read tool', () => {
    it('reads a file with line numbers', async () => {
      vfs.writeFile('/home/user/workspace/test.txt', 'line1\nline2\nline3');
      const tools = createTools(agentCtx);
      const readTool = tools.find(t => t.name === 'read')!;

      const result = await readTool.execute({ path: '/home/user/workspace/test.txt' });
      expect(result.content[0]).toHaveProperty('type', 'text');
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('line1');
      expect(text).toContain('line2');
      expect(text).toContain('line3');
      // Check line numbers
      expect(text).toMatch(/1.*\|.*line1/);
      expect(text).toMatch(/2.*\|.*line2/);
    });

    it('reads with offset and limit', async () => {
      vfs.writeFile('/home/user/workspace/test.txt', 'a\nb\nc\nd\ne');
      const tools = createTools(agentCtx);
      const readTool = tools.find(t => t.name === 'read')!;

      const result = await readTool.execute({ path: '/home/user/workspace/test.txt', offset: 2, limit: 2 });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('b');
      expect(text).toContain('c');
      expect(text).not.toContain('| a');
      expect(text).not.toContain('| d');
    });

    it('returns error for non-existent file', async () => {
      const tools = createTools(agentCtx);
      const readTool = tools.find(t => t.name === 'read')!;

      const result = await readTool.execute({ path: '/no/such/file' });
      expect(result.content[0]).toHaveProperty('type', 'error');
    });
  });

  describe('write tool', () => {
    it('writes a file', async () => {
      const tools = createTools(agentCtx);
      const writeTool = tools.find(t => t.name === 'write')!;

      const result = await writeTool.execute({
        path: '/home/user/workspace/new.txt',
        content: 'hello world',
      });
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(vfs.readFileString('/home/user/workspace/new.txt')).toBe('hello world');
    });

    it('creates parent directories', async () => {
      const tools = createTools(agentCtx);
      const writeTool = tools.find(t => t.name === 'write')!;

      await writeTool.execute({
        path: '/home/user/workspace/deep/nested/file.txt',
        content: 'deep',
      });
      expect(vfs.readFileString('/home/user/workspace/deep/nested/file.txt')).toBe('deep');
    });
  });

  describe('edit tool', () => {
    it('replaces exact string match', async () => {
      vfs.writeFile('/home/user/workspace/edit.txt', 'hello world');
      const tools = createTools(agentCtx);
      const editTool = tools.find(t => t.name === 'edit')!;

      const result = await editTool.execute({
        path: '/home/user/workspace/edit.txt',
        old_string: 'hello',
        new_string: 'goodbye',
      });
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(vfs.readFileString('/home/user/workspace/edit.txt')).toBe('goodbye world');
    });

    it('errors on non-matching string', async () => {
      vfs.writeFile('/home/user/workspace/edit.txt', 'hello world');
      const tools = createTools(agentCtx);
      const editTool = tools.find(t => t.name === 'edit')!;

      const result = await editTool.execute({
        path: '/home/user/workspace/edit.txt',
        old_string: 'not found',
        new_string: 'replacement',
      });
      expect(result.content[0]).toHaveProperty('type', 'error');
    });

    it('errors on ambiguous match', async () => {
      vfs.writeFile('/home/user/workspace/edit.txt', 'aaa bbb aaa');
      const tools = createTools(agentCtx);
      const editTool = tools.find(t => t.name === 'edit')!;

      const result = await editTool.execute({
        path: '/home/user/workspace/edit.txt',
        old_string: 'aaa',
        new_string: 'ccc',
      });
      expect(result.content[0]).toHaveProperty('type', 'error');
      expect((result.content[0] as { type: 'error'; message: string }).message).toContain('2 occurrences');
    });
  });

  describe('ls tool', () => {
    it('lists directory contents', async () => {
      vfs.writeFile('/home/user/workspace/a.txt', 'a');
      vfs.writeFile('/home/user/workspace/b.txt', 'b');
      vfs.mkdir('/home/user/workspace/subdir');

      const tools = createTools(agentCtx);
      const lsTool = tools.find(t => t.name === 'ls')!;

      const result = await lsTool.execute({ path: '/home/user/workspace' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('a.txt');
      expect(text).toContain('b.txt');
      expect(text).toContain('subdir');
    });

    it('shows directory prefix', async () => {
      vfs.mkdir('/home/user/workspace/mydir');
      vfs.writeFile('/home/user/workspace/myfile', 'x');

      const tools = createTools(agentCtx);
      const lsTool = tools.find(t => t.name === 'ls')!;

      const result = await lsTool.execute({ path: '/home/user/workspace' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('d mydir');
      expect(text).toContain('- myfile');
    });

    it('errors on non-existent directory', async () => {
      const tools = createTools(agentCtx);
      const lsTool = tools.find(t => t.name === 'ls')!;

      const result = await lsTool.execute({ path: '/no/such/dir' });
      expect(result.content[0]).toHaveProperty('type', 'error');
    });
  });

  describe('exec tool', () => {
    it('returns error when shell not available', async () => {
      const tools = createTools(agentCtx);
      const execTool = tools.find(t => t.name === 'exec')!;

      const result = await execTool.execute({ command: 'ls' });
      expect(result.content[0]).toHaveProperty('type', 'error');
    });

    it('executes when shell is provided', async () => {
      const ctxWithShell: AgentContext = {
        ...agentCtx,
        executeShell: async (cmd: string) => `output of: ${cmd}`,
      };
      const tools = createTools(ctxWithShell);
      const execTool = tools.find(t => t.name === 'exec')!;

      const result = await execTool.execute({ command: 'echo hello' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('output of: echo hello');
    });

    it('errors on empty command', async () => {
      const tools = createTools(agentCtx);
      const execTool = tools.find(t => t.name === 'exec')!;

      const result = await execTool.execute({ command: '' });
      expect(result.content[0]).toHaveProperty('type', 'error');
    });
  });

  describe('web_fetch tool', () => {
    it('has correct schema', () => {
      const tools = createTools(agentCtx);
      const fetchTool = tools.find(t => t.name === 'web_fetch')!;
      expect(fetchTool).toBeDefined();
      expect(fetchTool.inputSchema.required).toContain('url');
    });
  });

  it('creates all 6 tools', () => {
    const tools = createTools(agentCtx);
    expect(tools.length).toBe(6);
    const names = tools.map(t => t.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('exec');
    expect(names).toContain('web_fetch');
    expect(names).toContain('ls');
  });
});

// ─── Phase 4.5: Agent Runner with Mock LLM ───

describe('AgentRunner', () => {
  let vfs: VFS;
  let sessions: SessionManager;
  let tools: ReturnType<typeof createTools>;

  beforeEach(() => {
    vfs = new VFS();
    vfs.mkdir('/home/user/.openclaw/sessions', { recursive: true });
    vfs.mkdir('/home/user/workspace', { recursive: true });
    sessions = new SessionManager(vfs);
    const agentCtx = makeAgentContext(vfs);
    tools = createTools(agentCtx);
  });

  function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'sk-test-key',
      maxTokens: 1024,
      temperature: 0,
      maxIterations: 10,
      ...overrides,
    };
  }

  it('runs a simple text response (no tool use)', async () => {
    const config = makeConfig();

    // Mock fetch for Anthropic API
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello! I can help you with that.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('hello');

    expect(result.text).toBe('Hello! I can help you with that.');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.usage.totalTokens).toBe(30);

    // Verify fetch was called with correct args
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-test-key');
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('test-model');
    // Messages should include the user message
    expect(body.messages.some((m: { content: string }) => m.content === 'hello')).toBe(true);

    vi.unstubAllGlobals();
  });

  it('executes tool calls in agentic loop', async () => {
    const config = makeConfig();

    // Write a file for the agent to read
    vfs.writeFile('/home/user/workspace/hello.txt', 'world');

    const mockFetch = vi.fn()
      // First call: LLM wants to use the read tool
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'text', text: 'Let me read that file for you.' },
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'read',
              input: { path: '/home/user/workspace/hello.txt' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 15, output_tokens: 25 },
        }),
      })
      // Second call: LLM provides final response after seeing tool result
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'The file contains: world' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 15 },
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const events: string[] = [];
    const handler: AgentEventHandler = {
      onToolStart(name) { events.push(`start:${name}`); },
      onToolResult(name) { events.push(`result:${name}`); },
    };

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('read hello.txt', handler);

    expect(result.text).toBe('The file contains: world');
    expect(result.usage.inputTokens).toBe(45); // 15 + 30
    expect(result.usage.outputTokens).toBe(40); // 25 + 15
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['start:read', 'result:read']);

    // Verify second call includes tool_result
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const lastMsg = secondBody.messages[secondBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_result', tool_use_id: 'tool_1' }),
      ]),
    );

    vi.unstubAllGlobals();
  });

  it('handles unknown tool gracefully', async () => {
    const config = makeConfig();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'tool_bad',
              name: 'nonexistent_tool',
              input: {},
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Sorry, that tool is not available.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('use bad tool');
    expect(result.text).toBe('Sorry, that tool is not available.');

    // Verify error was passed back as tool_result
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const lastMsg = secondBody.messages[secondBody.messages.length - 1];
    const toolResult = lastMsg.content.find((c: { type: string }) => c.type === 'tool_result');
    expect(toolResult.content).toContain('Unknown tool');

    vi.unstubAllGlobals();
  });

  it('respects maxIterations', async () => {
    const config = makeConfig({ maxIterations: 2 });

    // Always return tool_use to force hitting the iteration limit
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'tool_use',
            id: `tool_${Date.now()}`,
            name: 'ls',
            input: { path: '/home/user/workspace' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const errors: string[] = [];
    const handler: AgentEventHandler = {
      onError(error) { errors.push(error.message); },
    };

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('loop forever', handler);

    expect(result.text).toContain('exceeded maximum iterations');
    expect(mockFetch.mock.calls.length).toBe(2);
    expect(errors.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it('handles API errors', async () => {
    const config = makeConfig();

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_api_key"}',
    });

    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    await expect(runner.run('hello')).rejects.toThrow('Anthropic API error 401');

    vi.unstubAllGlobals();
  });

  it('respects abort signal', async () => {
    const config = makeConfig();
    const controller = new AbortController();
    controller.abort();

    const runner = new AgentRunner(config, tools, sessions);
    await expect(runner.run('hello', undefined, controller.signal)).rejects.toThrow('aborted');
  });

  it('stores messages in session', async () => {
    const config = makeConfig();

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'reply' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    await runner.run('test message');

    // Check session has messages
    const sessionId = runner.getSessionId();
    const messages = sessions.loadMessages(sessionId);
    expect(messages.length).toBe(2); // user + assistant
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('test message');
    expect(messages[1].role).toBe('assistant');

    vi.unstubAllGlobals();
  });

  it('works with OpenAI provider', async () => {
    const config = makeConfig({ provider: 'openai', model: 'gpt-4o' });

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: 'OpenAI response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('hello from openai');

    expect(result.text).toBe('OpenAI response');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(8);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');

    vi.unstubAllGlobals();
  });

  it('handles OpenAI tool_calls response', async () => {
    const config = makeConfig({ provider: 'openai', model: 'gpt-4o' });

    vfs.writeFile('/home/user/workspace/data.txt', 'important data');

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'call_123',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ path: '/home/user/workspace/data.txt' }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 15, completion_tokens: 20 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'The file says: important data' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 30, completion_tokens: 10 },
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const runner = new AgentRunner(config, tools, sessions);
    const result = await runner.run('read data.txt');
    expect(result.text).toBe('The file says: important data');

    vi.unstubAllGlobals();
  });
});
