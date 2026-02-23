import type { Shell } from '../shell/Shell.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { Command } from '../commands/types.js';
import type { SandboxCommands as ISandboxCommands, RunOptions, CommandResult } from './types.js';

/**
 * Wraps Shell.execute() and serializes concurrent calls.
 * Concurrent commands.run() calls are queued (matches real shell behavior).
 */
export class SandboxCommandsImpl implements ISandboxCommands {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private shell: Shell,
    private registry: CommandRegistry,
  ) {}

  run(cmd: string, options?: RunOptions): Promise<CommandResult> {
    // Serialize execution: queue each call so they run one at a time
    const result = new Promise<CommandResult>((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const res = await this.executeWithOptions(cmd, options);
          resolve(res);
        } catch (e) {
          reject(e);
        }
      });
    });
    return result;
  }

  register(name: string, handler: Command): void {
    this.registry.register(name, handler);
  }

  private async executeWithOptions(cmd: string, options?: RunOptions): Promise<CommandResult> {
    // Handle timeout + abort signal
    let abortController: AbortController | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout || options?.signal) {
      abortController = new AbortController();

      if (options.signal) {
        // Forward external signal
        if (options.signal.aborted) {
          return { stdout: '', stderr: '', exitCode: 130 };
        }
        options.signal.addEventListener('abort', () => abortController!.abort(), { once: true });
      }

      if (options.timeout) {
        timeoutId = setTimeout(() => abortController!.abort(), options.timeout);
      }
    }

    try {
      const result = await this.shell.execute(cmd, {
        cwd: options?.cwd,
        env: options?.env,
        onStdout: options?.onStdout,
        onStderr: options?.onStderr,
        stdin: options?.stdin,
      });

      return result;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }
}
