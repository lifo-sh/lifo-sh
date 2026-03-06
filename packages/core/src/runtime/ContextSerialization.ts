/**
 * Context serialization for worker communication.
 * Converts CommandContext to/from serializable format.
 */

import type { CommandContext } from '../commands/types.js';

/**
 * Serializable version of CommandContext that can be sent to workers
 */
export interface SerializableContext {
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** Ports for stream communication */
  stdoutPort: MessagePort;
  stderrPort: MessagePort;
  stdinPort?: MessagePort;
  /** IndexedDB database name for VFS */
  vfsDbName: string;
  /** Signal for cancellation */
  abortSignal?: boolean;
  /** Port registry communication port */
  portRegistryPort?: MessagePort;
}

/**
 * Message types for worker communication
 */
export type WorkerMessage =
  | { type: 'execute'; id: string; command: string; ctx: Omit<SerializableContext, 'stdoutPort' | 'stderrPort' | 'stdinPort'>; ports: { stdout: MessagePort; stderr: MessagePort; stdin?: MessagePort } }
  | { type: 'result'; id: string; exitCode: number }
  | { type: 'error'; id: string; error: string }
  | { type: 'ready' }
  | { type: 'abort'; id: string }
  // shellExecute: worker requests main thread to execute a shell command
  | { type: 'shellExecute'; requestId: string; cmd: string; ctx: Omit<SerializableContext, 'stdoutPort' | 'stderrPort' | 'stdinPort'>; ports: { stdout: MessagePort; stderr: MessagePort; stdin?: MessagePort } }
  | { type: 'shellExecuteResult'; requestId: string; exitCode: number }
  | { type: 'shellExecuteError'; requestId: string; error: string }
  // Port registration: worker notifies main thread about port listen/close
  | { type: 'portRegister'; port: number; requestPort: MessagePort }
  | { type: 'portUnregister'; port: number }
  | { type: 'portRequest'; port: number; requestId: string; method: string; url: string; headers: Record<string, string>; body: string; responsePort: MessagePort }
  | { type: 'portResponse'; requestId: string; statusCode: number; headers: Record<string, string>; body: string };

export type StreamMessage =
  | { type: 'data'; data: string }
  | { type: 'end' }
  | { type: 'read' }
  | { type: 'read-result'; data: string | null };

/**
 * Create MessagePort-based stream adapters
 */
export function createStreamPort(): { port1: MessagePort; port2: MessagePort } {
  const channel = new MessageChannel();
  return { port1: channel.port1, port2: channel.port2 };
}

/**
 * Serialize CommandContext for worker execution
 */
export function serializeContext(
  ctx: CommandContext,
  vfsDbName: string
): {
  serializable: Omit<SerializableContext, 'stdoutPort' | 'stderrPort' | 'stdinPort'>;
  ports: { stdout: MessagePort; stderr: MessagePort; stdin?: MessagePort };
  localPorts: { stdout: MessagePort; stderr: MessagePort; stdin?: MessagePort };
} {
  // Create MessageChannel for stdout
  const stdoutChannel = new MessageChannel();
  const stderrChannel = new MessageChannel();
  const stdinChannel = ctx.stdin ? new MessageChannel() : undefined;

  const serializable = {
    args: ctx.args,
    env: ctx.env,
    cwd: ctx.cwd,
    vfsDbName,
    abortSignal: ctx.signal?.aborted,
  };

  const ports = {
    stdout: stdoutChannel.port2,
    stderr: stderrChannel.port2,
    stdin: stdinChannel?.port2,
  };

  const localPorts = {
    stdout: stdoutChannel.port1,
    stderr: stderrChannel.port1,
    stdin: stdinChannel?.port1,
  };

  return { serializable, ports, localPorts };
}

/**
 * Create a wrapper that forwards writes to MessagePort
 */
export function createMessagePortOutputStream(port: MessagePort) {
  return {
    write(text: string): void {
      port.postMessage({ type: 'data', data: text } as StreamMessage);
    },
    end(): void {
      port.postMessage({ type: 'end' } as StreamMessage);
    },
  };
}

/**
 * Create a wrapper that reads from MessagePort
 */
export function createMessagePortInputStream(port: MessagePort) {
  let buffer: string[] = [];
  let endReceived = false;
  let readResolver: ((value: string | null) => void) | null = null;

  port.onmessage = (event: MessageEvent<StreamMessage>) => {
    const msg = event.data;
    if (msg.type === 'data') {
      if (readResolver) {
        readResolver(msg.data);
        readResolver = null;
      } else {
        buffer.push(msg.data);
      }
    } else if (msg.type === 'end') {
      endReceived = true;
      if (readResolver) {
        readResolver(null);
        readResolver = null;
      }
    }
  };

  return {
    async read(): Promise<string | null> {
      if (buffer.length > 0) {
        return buffer.shift()!;
      }
      if (endReceived) {
        return null;
      }
      return new Promise<string | null>((resolve) => {
        readResolver = resolve;
      });
    },
    async readAll(): Promise<string> {
      let result = buffer.join('');
      buffer = [];

      if (endReceived) {
        return result;
      }

      // Read until end
      while (true) {
        const chunk = await this.read();
        if (chunk === null) break;
        result += chunk;
      }
      return result;
    },
  };
}

/**
 * Bridge local CommandContext streams to MessagePorts
 */
export function bridgeStreamsToWorker(
  ctx: CommandContext,
  localPorts: { stdout: MessagePort; stderr: MessagePort; stdin?: MessagePort },
  abortSignal?: AbortSignal
): void {
  // Bridge stdout from worker to local context
  localPorts.stdout.onmessage = (event: MessageEvent<StreamMessage>) => {
    const msg = event.data;
    if (msg.type === 'data') {
      ctx.stdout.write(msg.data);
    }
  };

  // Bridge stderr from worker to local context
  localPorts.stderr.onmessage = (event: MessageEvent<StreamMessage>) => {
    const msg = event.data;
    if (msg.type === 'data') {
      ctx.stderr.write(msg.data);
    }
  };

  // Bridge stdin from local context to worker (if exists)
  if (localPorts.stdin && ctx.stdin) {
    const forwardStdin = async () => {
      try {
        while (!abortSignal?.aborted) {
          const chunk = await ctx.stdin!.read();
          if (chunk === null) {
            localPorts.stdin!.postMessage({ type: 'end' } as StreamMessage);
            break;
          }
          localPorts.stdin!.postMessage({ type: 'data', data: chunk } as StreamMessage);
        }
      } catch (error) {
        // stdin read failed or aborted
      }
    };
    forwardStdin();
  }
}
