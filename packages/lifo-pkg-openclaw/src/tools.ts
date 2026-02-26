import type { VFS } from '@lifo-sh/core';
import { resolve } from '@lifo-sh/core';
import type { AgentTool, ToolResult, AgentContext } from './types.js';

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'error', message }] };
}

// ─── Read Tool ───

function createReadTool(ctx: AgentContext): AgentTool {
  return {
    name: 'read',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
    async execute(params) {
      const path = resolve(ctx.cwd, String(params.path || ''));
      try {
        const content = ctx.vfs.readFileString(path);
        const lines = content.split('\n');
        const offset = Math.max(0, (Number(params.offset) || 1) - 1);
        const limit = Number(params.limit) || lines.length;
        const slice = lines.slice(offset, offset + limit);

        const numbered = slice.map((line, i) =>
          `${String(offset + i + 1).padStart(6)} | ${line}`
        ).join('\n');

        return textResult(numbered || '(empty file)');
      } catch (e) {
        return errorResult(`Failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── Write Tool ───

function createWriteTool(ctx: AgentContext): AgentTool {
  return {
    name: 'write',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['path', 'content'],
    },
    async execute(params) {
      const path = resolve(ctx.cwd, String(params.path || ''));
      const content = String(params.content ?? '');
      try {
        // Ensure parent directory exists
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir && !ctx.vfs.exists(dir)) {
          ctx.vfs.mkdir(dir, { recursive: true });
        }
        ctx.vfs.writeFile(path, content);
        return textResult(`Successfully wrote ${content.length} bytes to ${path}`);
      } catch (e) {
        return errorResult(`Failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── Edit Tool ───

function createEditTool(ctx: AgentContext): AgentTool {
  return {
    name: 'edit',
    description: 'Make targeted edits to an existing file. Finds and replaces an exact string match.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(params) {
      const path = resolve(ctx.cwd, String(params.path || ''));
      const oldStr = String(params.old_string ?? '');
      const newStr = String(params.new_string ?? '');

      try {
        const content = ctx.vfs.readFileString(path);

        if (!content.includes(oldStr)) {
          return errorResult(
            `Could not find the exact string to replace in ${path}. ` +
            `Make sure old_string matches exactly (including whitespace and indentation).`
          );
        }

        const occurrences = content.split(oldStr).length - 1;
        if (occurrences > 1) {
          return errorResult(
            `Found ${occurrences} occurrences of old_string in ${path}. ` +
            `Provide more surrounding context to make the match unique.`
          );
        }

        const newContent = content.replace(oldStr, newStr);
        ctx.vfs.writeFile(path, newContent);
        return textResult(`Successfully edited ${path}`);
      } catch (e) {
        return errorResult(`Failed to edit ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── Exec Tool (bash via Lifo shell) ───

function createExecTool(ctx: AgentContext): AgentTool {
  return {
    name: 'exec',
    description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command (optional)' },
      },
      required: ['command'],
    },
    async execute(params) {
      const command = String(params.command || '');
      if (!command.trim()) {
        return errorResult('No command provided');
      }

      try {
        const output = await ctx.executeShell(command);
        if (output.length === 0) {
          return textResult('(no output)');
        }
        // Truncate very long output
        const maxLen = 30000;
        if (output.length > maxLen) {
          return textResult(
            output.slice(0, maxLen) +
            `\n\n... (truncated ${output.length - maxLen} chars)`
          );
        }
        return textResult(output);
      } catch (e) {
        return errorResult(`Command failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── Web Fetch Tool ───

function createWebFetchTool(): AgentTool {
  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns the response body as text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
    async execute(params) {
      const url = String(params.url || '');

      try {
        const response = await fetch(url, {
          method: String(params.method || 'GET'),
          headers: params.headers as Record<string, string> | undefined,
          body: params.body ? String(params.body) : undefined,
        });

        const text = await response.text();

        // Truncate very long responses
        const maxLen = 50000;
        const truncated = text.length > maxLen
          ? text.slice(0, maxLen) + `\n\n... (truncated ${text.length - maxLen} chars)`
          : text;

        return textResult(
          `HTTP ${response.status} ${response.statusText}\n\n${truncated}`
        );
      } catch (e) {
        return errorResult(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── List Files Tool ───

function createListTool(ctx: AgentContext): AgentTool {
  return {
    name: 'ls',
    description: 'List files and directories at the given path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default: cwd)' },
      },
    },
    async execute(params) {
      const path = resolve(ctx.cwd, String(params.path || ctx.cwd));
      try {
        const entries = ctx.vfs.readdir(path);
        if (entries.length === 0) return textResult('(empty directory)');

        const lines = entries.map(e => {
          const prefix = e.type === 'directory' ? 'd ' : '- ';
          return prefix + e.name;
        });
        return textResult(lines.join('\n'));
      } catch (e) {
        return errorResult(`Failed to list ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ─── Tool Factory ───

export function createTools(ctx: AgentContext): AgentTool[] {
  return [
    createReadTool(ctx),
    createWriteTool(ctx),
    createEditTool(ctx),
    createExecTool(ctx),
    createWebFetchTool(),
    createListTool(ctx),
  ];
}
