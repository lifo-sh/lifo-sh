import type { Command, CommandOutputStream } from '../types.js';
import type { CommandRegistry } from '../registry.js';

export function createWatchCommand(registry: CommandRegistry): Command {
  return async (ctx) => {
    let interval = 2;
    let argStart = 0;

    // Parse -n interval
    if (ctx.args[0] === '-n' && ctx.args.length > 1) {
      const parsed = parseFloat(ctx.args[1]);
      if (!isNaN(parsed) && parsed > 0) {
        interval = parsed;
      }
      argStart = 2;
    }

    if (argStart >= ctx.args.length) {
      ctx.stderr.write('watch: missing command\n');
      return 1;
    }

    const cmdName = ctx.args[argStart];
    const cmdArgs = ctx.args.slice(argStart + 1);
    const fullCmd = ctx.args.slice(argStart).join(' ');

    const command = await registry.resolve(cmdName);
    if (!command) {
      ctx.stderr.write(`watch: ${cmdName}: command not found\n`);
      return 1;
    }

    const runOnce = async () => {
      // Clear screen
      ctx.stdout.write('\x1b[2J\x1b[H');
      ctx.stdout.write(`Every ${interval}s: ${fullCmd}\n\n`);

      const output: string[] = [];
      const collectStdout: CommandOutputStream = {
        write(t: string) { output.push(t); },
      };

      await command({
        args: cmdArgs,
        env: ctx.env,
        cwd: ctx.cwd,
        vfs: ctx.vfs,
        stdout: collectStdout,
        stderr: ctx.stderr,
        signal: ctx.signal,
      });

      ctx.stdout.write(output.join(''));
    };

    // Run immediately
    await runOnce();

    // Then repeat on interval until aborted
    return new Promise<number>((resolve) => {
      const timer = setInterval(async () => {
        if (ctx.signal.aborted) {
          clearInterval(timer);
          resolve(0);
          return;
        }
        await runOnce();
      }, interval * 1000);

      // Listen for abort
      ctx.signal.addEventListener('abort', () => {
        clearInterval(timer);
        resolve(0);
      }, { once: true });
    });
  };
}
