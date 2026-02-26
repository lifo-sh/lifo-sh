import { EventEmitter } from './events.js';

// ─── Main thread indicators ───

export const isMainThread = true;
export const threadId = 0;
export const parentPort: null = null;
export const workerData: null = null;

// ─── MessageChannel / MessagePort ───

export class MessagePort extends EventEmitter {
  private _otherPort: MessagePort | null = null;
  private _started = false;

  start(): void {
    this._started = true;
  }

  postMessage(value: unknown, _transferList?: unknown[]): void {
    if (this._otherPort) {
      const other = this._otherPort;
      queueMicrotask(() => {
        other.emit('message', value);
      });
    }
  }

  close(): void {
    this.emit('close');
  }

  ref(): this { return this; }
  unref(): this { return this; }

  /** @internal */
  _setPeer(port: MessagePort): void {
    this._otherPort = port;
  }
}

export class MessageChannel {
  port1: MessagePort;
  port2: MessagePort;

  constructor() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
    this.port1._setPeer(this.port2);
    this.port2._setPeer(this.port1);
  }
}

// ─── Worker (maps to Web Worker when possible) ───

export class Worker extends EventEmitter {
  threadId: number;
  private _terminated = false;

  constructor(filename: string | URL, _options?: Record<string, unknown>) {
    super();
    this.threadId = Math.floor(Math.random() * 10000) + 1;

    // In browser, we could try to create a Web Worker, but for now
    // emit an error since most Node worker_threads code won't work as-is.
    queueMicrotask(() => {
      this.emit('error', new Error(
        `worker_threads.Worker is not fully supported in Lifo. ` +
        `Cannot load: ${filename}`
      ));
      this.emit('exit', 1);
    });
  }

  postMessage(value: unknown, _transferList?: unknown[]): void {
    // No-op if worker never started
  }

  terminate(): Promise<number> {
    this._terminated = true;
    this.emit('exit', 0);
    return Promise.resolve(0);
  }

  ref(): this { return this; }
  unref(): this { return this; }

  getHeapSnapshot(): Promise<unknown> {
    return Promise.reject(new Error('Not supported'));
  }
}

// ─── Shared resources ───

export const resourceLimits = {};

export function getEnvironmentData(_key: string): unknown {
  return undefined;
}

export function setEnvironmentData(_key: string, _value: unknown): void {
  // No-op
}

export function markAsUntransferable(_obj: unknown): void {
  // No-op
}

export function moveMessagePortToContext(_port: MessagePort, _context: unknown): MessagePort {
  return _port;
}

export function receiveMessageOnPort(_port: MessagePort): { message: unknown } | undefined {
  return undefined;
}

export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

export default {
  isMainThread,
  threadId,
  parentPort,
  workerData,
  Worker,
  MessagePort,
  MessageChannel,
  resourceLimits,
  getEnvironmentData,
  setEnvironmentData,
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  SHARE_ENV,
};
