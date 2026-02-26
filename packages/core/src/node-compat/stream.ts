import { EventEmitter } from './events.js';

// ─── Readable ───

export class Readable extends EventEmitter {
  private _buffer: (string | Uint8Array)[] = [];
  protected _ended = false;
  private _flowing: boolean | null = null;
  private _encoding: string | null = null;
  readable = true;
  readableEnded = false;
  readableFlowing: boolean | null = null;
  readableLength = 0;
  readableObjectMode = false;

  constructor(_options?: Record<string, unknown>) {
    super();
  }

  push(chunk: string | Uint8Array | null): boolean {
    if (chunk === null) {
      this._ended = true;
      this.readable = false;
      this.readableEnded = true;
      this.emit('end');
      this.emit('close');
      return false;
    }

    this._buffer.push(chunk);
    this.readableLength += typeof chunk === 'string' ? chunk.length : chunk.byteLength;

    if (this._flowing !== false) {
      this._flowing = true;
      this.readableFlowing = true;
      this.emit('data', chunk);
    }

    return true;
  }

  read(size?: number): string | Uint8Array | null {
    if (this._buffer.length === 0) return null;

    if (size === undefined || size === 0) {
      const chunk = this._buffer.shift()!;
      this.readableLength -= typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      return chunk;
    }

    // Simplified: return first chunk regardless of size
    const chunk = this._buffer.shift()!;
    this.readableLength -= typeof chunk === 'string' ? chunk.length : chunk.byteLength;
    return chunk;
  }

  pipe<T extends Writable>(dest: T, _options?: { end?: boolean }): T {
    this._flowing = true;
    this.readableFlowing = true;

    // Flush buffered data
    while (this._buffer.length > 0) {
      const chunk = this._buffer.shift()!;
      this.readableLength -= typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      dest.write(chunk as string);
    }

    this.on('data', (chunk) => dest.write(chunk as string));
    if (_options?.end !== false) {
      this.on('end', () => dest.end());
    }

    dest.emit('pipe', this);
    return dest;
  }

  unpipe(dest?: Writable): this {
    if (dest) {
      this.removeAllListeners('data');
      dest.emit('unpipe', this);
    } else {
      this.removeAllListeners('data');
    }
    return this;
  }

  destroy(error?: Error): this {
    if (!this.readable) return this;
    this._ended = true;
    this.readable = false;
    this._buffer.length = 0;
    this.readableLength = 0;
    if (error) this.emit('error', error);
    this.emit('close');
    return this;
  }

  setEncoding(encoding: string): this {
    this._encoding = encoding;
    return this;
  }

  resume(): this {
    this._flowing = true;
    this.readableFlowing = true;
    // Flush buffered data
    while (this._buffer.length > 0) {
      const chunk = this._buffer.shift()!;
      this.readableLength -= typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      this.emit('data', chunk);
    }
    return this;
  }

  pause(): this {
    this._flowing = false;
    this.readableFlowing = false;
    return this;
  }

  wrap(_stream: unknown): this {
    return this;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<string | Uint8Array> {
    const self = this;
    const buffer: (string | Uint8Array)[] = [];
    let resolve: ((value: IteratorResult<string | Uint8Array>) => void) | null = null;
    let done = false;

    self.on('data', (chunk) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: chunk as string | Uint8Array, done: false });
      } else {
        buffer.push(chunk as string | Uint8Array);
      }
    });

    self.on('end', () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as string, done: true });
      }
    });

    self.on('error', () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as string, done: true });
      }
    });

    return {
      next(): Promise<IteratorResult<string | Uint8Array>> {
        if (buffer.length > 0) {
          return Promise.resolve({ value: buffer.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        }
        return new Promise((r) => { resolve = r; });
      },
      return(): Promise<IteratorResult<string | Uint8Array>> {
        done = true;
        self.destroy();
        return Promise.resolve({ value: undefined as unknown as string, done: true });
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }

  // Static helper
  static from(iterable: Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>): Readable {
    const stream = new Readable();

    if (Symbol.asyncIterator in (iterable as AsyncIterable<string | Uint8Array>)) {
      (async () => {
        try {
          for await (const chunk of iterable as AsyncIterable<string | Uint8Array>) {
            stream.push(chunk);
          }
          stream.push(null);
        } catch (err) {
          stream.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    } else {
      queueMicrotask(() => {
        try {
          for (const chunk of iterable as Iterable<string | Uint8Array>) {
            stream.push(chunk);
          }
          stream.push(null);
        } catch (err) {
          stream.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      });
    }

    return stream;
  }
}

// ─── Writable ───

export class Writable extends EventEmitter {
  private _ended = false;
  writable = true;
  writableEnded = false;
  writableFinished = false;
  writableLength = 0;
  writableObjectMode = false;

  constructor(_options?: Record<string, unknown>) {
    super();
  }

  write(chunk: string | Uint8Array, encodingOrCb?: string | (() => void), cb?: () => void): boolean {
    if (this._ended) return false;

    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

    this.emit('data', chunk);
    if (callback) callback();
    return true;
  }

  end(chunkOrCb?: string | Uint8Array | (() => void), encodingOrCb?: string | (() => void), cb?: () => void): this {
    let callback: (() => void) | undefined;

    if (typeof chunkOrCb === 'function') {
      callback = chunkOrCb;
    } else {
      if (chunkOrCb != null) this.write(chunkOrCb);
      if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb;
      } else {
        callback = cb;
      }
    }

    this._ended = true;
    this.writable = false;
    this.writableEnded = true;
    this.writableFinished = true;
    this.emit('finish');
    this.emit('close');
    if (callback) callback();
    return this;
  }

  destroy(error?: Error): this {
    if (!this.writable && this._ended) return this;
    this._ended = true;
    this.writable = false;
    if (error) this.emit('error', error);
    this.emit('close');
    return this;
  }

  cork(): void { /* no-op */ }
  uncork(): void { /* no-op */ }

  setDefaultEncoding(_encoding: string): this {
    return this;
  }
}

// ─── Duplex ───

export class Duplex extends Readable {
  writable = true;
  writableEnded = false;
  writableFinished = false;
  private _writableEnded = false;

  constructor(_options?: Record<string, unknown>) {
    super(_options);
  }

  write(chunk: string | Uint8Array, encodingOrCb?: string | (() => void), cb?: () => void): boolean {
    if (this._writableEnded) return false;

    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

    this.emit('data', chunk);
    if (callback) callback();
    return true;
  }

  end(chunkOrCb?: string | Uint8Array | (() => void), encodingOrCb?: string | (() => void), cb?: () => void): this {
    let callback: (() => void) | undefined;

    if (typeof chunkOrCb === 'function') {
      callback = chunkOrCb;
    } else {
      if (chunkOrCb != null) this.write(chunkOrCb);
      if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb;
      } else {
        callback = cb;
      }
    }

    this._writableEnded = true;
    this.writable = false;
    this.writableEnded = true;
    this.writableFinished = true;
    this.emit('finish');
    if (callback) callback();
    return this;
  }

  cork(): void { /* no-op */ }
  uncork(): void { /* no-op */ }

  setDefaultEncoding(_encoding: string): this {
    return this;
  }
}

// ─── Transform ───

export class Transform extends Duplex {
  private _transformCallback: ((chunk: string | Uint8Array, encoding: string, callback: (error?: Error | null, data?: string | Uint8Array) => void) => void) | null = null;
  private _flushCallback: ((callback: (error?: Error | null, data?: string | Uint8Array) => void) => void) | null = null;

  constructor(options?: Record<string, unknown> & {
    transform?: (chunk: string | Uint8Array, encoding: string, callback: (error?: Error | null, data?: string | Uint8Array) => void) => void;
    flush?: (callback: (error?: Error | null, data?: string | Uint8Array) => void) => void;
  }) {
    super(options);

    if (options?.transform) {
      this._transformCallback = options.transform;
    }
    if (options?.flush) {
      this._flushCallback = options.flush;
    }
  }

  _transform(chunk: string | Uint8Array, encoding: string, callback: (error?: Error | null, data?: string | Uint8Array) => void): void {
    if (this._transformCallback) {
      this._transformCallback(chunk, encoding, callback);
    } else {
      callback(null, chunk);
    }
  }

  _flush(callback: (error?: Error | null, data?: string | Uint8Array) => void): void {
    if (this._flushCallback) {
      this._flushCallback(callback);
    } else {
      callback();
    }
  }

  override write(chunk: string | Uint8Array, encodingOrCb?: string | (() => void), cb?: () => void): boolean {
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;

    this._transform(chunk, encoding, (error, data) => {
      if (error) {
        this.emit('error', error);
      } else if (data != null) {
        this.push(data);
      }
      if (callback) callback();
    });

    return true;
  }

  override end(chunkOrCb?: string | Uint8Array | (() => void), encodingOrCb?: string | (() => void), cb?: () => void): this {
    let callback: (() => void) | undefined;

    if (typeof chunkOrCb === 'function') {
      callback = chunkOrCb;
    } else {
      if (chunkOrCb != null) this.write(chunkOrCb);
      if (typeof encodingOrCb === 'function') {
        callback = encodingOrCb;
      } else {
        callback = cb;
      }
    }

    this._flush((error, data) => {
      if (error) {
        this.emit('error', error);
      } else if (data != null) {
        this.push(data);
      }
      this.push(null);
      this.writable = false;
      this.writableEnded = true;
      this.writableFinished = true;
      this.emit('finish');
      if (callback) callback();
    });

    return this;
  }
}

// ─── PassThrough ───

export class PassThrough extends Transform {
  constructor(options?: Record<string, unknown>) {
    super({
      ...options,
      transform(chunk: string | Uint8Array, _encoding: string, callback: (error?: Error | null, data?: string | Uint8Array) => void) {
        callback(null, chunk);
      },
    });
  }
}

// ─── pipeline ───

type PipelineCallback = (err: Error | null) => void;
type StreamLike = Readable | Writable | Transform | Duplex;

export function pipeline(...args: [...StreamLike[], PipelineCallback]): void;
export function pipeline(): void {
  const args = Array.from(arguments) as unknown[];
  const callback = args.pop() as PipelineCallback;

  if (typeof callback !== 'function') {
    throw new Error('pipeline requires a callback as the last argument');
  }

  const streams = args as StreamLike[];

  if (streams.length < 2) {
    queueMicrotask(() => callback(new Error('pipeline requires at least 2 streams')));
    return;
  }

  let error: Error | null = null;

  for (let i = 0; i < streams.length - 1; i++) {
    const source = streams[i] as Readable;
    const dest = streams[i + 1];

    if (typeof source.pipe === 'function') {
      source.pipe(dest as Writable);
    }

    // Propagate errors
    source.on('error', (err) => {
      if (!error) {
        error = err as Error;
        callback(error);
      }
    });
  }

  // Listen for finish on last stream
  const last = streams[streams.length - 1];
  last.on('error', (err) => {
    if (!error) {
      error = err as Error;
      callback(error);
    }
  });

  last.on('finish', () => {
    if (!error) callback(null);
  });

  last.on('end', () => {
    if (!error) callback(null);
  });
}

// ─── finished ───

export function finished(stream: StreamLike, callback: (err?: Error | null) => void): () => void {
  let called = false;

  function done(err?: Error | null) {
    if (called) return;
    called = true;
    callback(err);
  }

  stream.on('error', (err) => done(err as Error));
  stream.on('end', () => done());
  stream.on('finish', () => done());
  stream.on('close', () => done());

  return () => {
    called = true;
    stream.removeAllListeners('error');
    stream.removeAllListeners('end');
    stream.removeAllListeners('finish');
    stream.removeAllListeners('close');
  };
}

// ─── promises namespace ───

export const promises = {
  pipeline: async (...streams: StreamLike[]): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const args = [...streams, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      }] as [...StreamLike[], PipelineCallback];
      pipeline(...args);
    });
  },
  finished: async (stream: StreamLike): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      finished(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
};

// ─── Default export ───

export default {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  promises,
};
