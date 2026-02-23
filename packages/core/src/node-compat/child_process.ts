import { EventEmitter } from './events.js';

type ExecuteCapture = (input: string) => Promise<string>;

export function createChildProcess(executeCapture?: ExecuteCapture) {
  function exec(
    cmd: string,
    optionsOrCb?: Record<string, unknown> | ((err: Error | null, stdout: string, stderr: string) => void),
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ): EventEmitter {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;
    const child = new EventEmitter();

    if (!executeCapture) {
      queueMicrotask(() => {
        const err = new Error('child_process.exec() requires shell interpreter');
        if (callback) callback(err, '', '');
        child.emit('error', err);
      });
      return child;
    }

    const run = executeCapture;
    queueMicrotask(async () => {
      try {
        const output = await run(cmd);
        if (callback) callback(null, output, '');
        child.emit('close', 0);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (callback) callback(err, '', err.message);
        child.emit('close', 1);
      }
    });

    return child;
  }

  function execSync(): never {
    throw new Error('child_process.execSync() is not supported in Lifo');
  }

  function spawn(): never {
    throw new Error('child_process.spawn() is not supported in Lifo');
  }

  function fork(): never {
    throw new Error('child_process.fork() is not supported in Lifo');
  }

  return { exec, execSync, spawn, fork };
}
