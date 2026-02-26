import { EventEmitter } from './events.js';

// ─── Interface ───

export class Interface extends EventEmitter {
  private _input: unknown;
  private _output: unknown;
  private _prompt = '> ';
  private _closed = false;
  terminal: boolean;

  constructor(options: {
    input?: unknown;
    output?: unknown;
    terminal?: boolean;
    prompt?: string;
  }) {
    super();
    this._input = options.input;
    this._output = options.output;
    this.terminal = options.terminal ?? false;
    if (options.prompt) this._prompt = options.prompt;
  }

  question(query: string, optionsOrCb?: Record<string, unknown> | ((answer: string) => void), cb?: (answer: string) => void): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;

    // Write the query to output if available
    const output = this._output as { write?: (data: string) => void } | undefined;
    if (output?.write) {
      output.write(query);
    }

    // In browser, we can't truly block for input.
    // Return empty string to unblock callers that don't critically need input.
    queueMicrotask(() => {
      if (callback) callback('');
    });
  }

  setPrompt(prompt: string): void {
    this._prompt = prompt;
  }

  prompt(_preserveCursor?: boolean): void {
    const output = this._output as { write?: (data: string) => void } | undefined;
    if (output?.write) {
      output.write(this._prompt);
    }
  }

  write(data: string, _key?: { ctrl?: boolean; name?: string }): void {
    const output = this._output as { write?: (data: string) => void } | undefined;
    if (output?.write) {
      output.write(data);
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.emit('close');
  }

  pause(): this {
    this.emit('pause');
    return this;
  }

  resume(): this {
    this.emit('resume');
    return this;
  }

  getCursorPos(): { rows: number; cols: number } {
    return { rows: 0, cols: 0 };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    let closed = false;

    this.on('close', () => { closed = true; });

    return {
      next: async (): Promise<IteratorResult<string>> => {
        if (closed) return { value: undefined as unknown as string, done: true };
        return { value: '', done: true };
      },
      return: async (): Promise<IteratorResult<string>> => {
        closed = true;
        this.close();
        return { value: undefined as unknown as string, done: true };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }
}

// ─── Factory functions ───

export function createInterface(optionsOrInput?: {
  input?: unknown;
  output?: unknown;
  terminal?: boolean;
  prompt?: string;
} | unknown, output?: unknown): Interface {
  if (optionsOrInput && typeof optionsOrInput === 'object' && ('input' in (optionsOrInput as Record<string, unknown>))) {
    return new Interface(optionsOrInput as {
      input?: unknown;
      output?: unknown;
      terminal?: boolean;
      prompt?: string;
    });
  }

  return new Interface({
    input: optionsOrInput,
    output,
  });
}

// ─── Promises API ───

export const promises = {
  createInterface: (options: {
    input?: unknown;
    output?: unknown;
    terminal?: boolean;
    prompt?: string;
  }) => {
    return createInterface(options);
  },
};

// ─── Helper functions ───

export function clearLine(_stream: unknown, _dir: number, cb?: () => void): boolean {
  if (cb) queueMicrotask(cb);
  return true;
}

export function clearScreenDown(_stream: unknown, cb?: () => void): boolean {
  if (cb) queueMicrotask(cb);
  return true;
}

export function cursorTo(_stream: unknown, _x: number, _y?: number | (() => void), cb?: () => void): boolean {
  const callback = typeof _y === 'function' ? _y : cb;
  if (callback) queueMicrotask(callback);
  return true;
}

export function moveCursor(_stream: unknown, _dx: number, _dy: number, cb?: () => void): boolean {
  if (cb) queueMicrotask(cb);
  return true;
}

export default {
  Interface,
  createInterface,
  promises,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
};
