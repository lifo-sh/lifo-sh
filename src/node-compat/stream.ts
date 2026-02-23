import { EventEmitter } from './events.js';

export class Readable extends EventEmitter {
  private _buffer: string[] = [];
  protected _ended = false;
  readable = true;

  push(chunk: string | null): void {
    if (chunk === null) {
      this._ended = true;
      this.readable = false;
      this.emit('end');
    } else {
      this._buffer.push(chunk);
      this.emit('data', chunk);
    }
  }

  read(): string | null {
    if (this._buffer.length > 0) return this._buffer.shift()!;
    return null;
  }

  pipe<T extends Writable>(dest: T): T {
    this.on('data', (chunk) => dest.write(chunk as string));
    this.on('end', () => dest.end());
    return dest;
  }

  destroy(): this {
    this._ended = true;
    this.readable = false;
    this.emit('close');
    return this;
  }

  setEncoding(_encoding: string): this {
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

export class Writable extends EventEmitter {
  private _ended = false;
  writable = true;

  write(chunk: string, _encoding?: string, cb?: () => void): boolean {
    if (this._ended) return false;
    this.emit('data', chunk);
    if (cb) cb();
    return true;
  }

  end(chunk?: string): void {
    if (chunk) this.write(chunk);
    this._ended = true;
    this.writable = false;
    this.emit('finish');
    this.emit('close');
  }

  destroy(): this {
    this._ended = true;
    this.writable = false;
    this.emit('close');
    return this;
  }
}

export class Duplex extends Readable {
  writable = true;
  private _writableEnded = false;

  write(chunk: string, _encoding?: string, cb?: () => void): boolean {
    if (this._writableEnded) return false;
    this.emit('data', chunk);
    if (cb) cb();
    return true;
  }

  end(chunk?: string): void {
    if (chunk) this.write(chunk);
    this._writableEnded = true;
    this.writable = false;
    this.emit('finish');
  }
}

export class PassThrough extends Duplex {}

export default { Readable, Writable, Duplex, PassThrough };
