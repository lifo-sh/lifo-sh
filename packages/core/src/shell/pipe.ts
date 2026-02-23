import type { CommandOutputStream, CommandInputStream } from '../commands/types.js';

export class PipeChannel {
  private buffer: string[] = [];
  private closed = false;
  private waiting: ((value: string | null) => void) | null = null;

  readonly writer: CommandOutputStream = {
    write: (text: string) => {
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(text);
      } else {
        this.buffer.push(text);
      }
    },
  };

  readonly reader: CommandInputStream = {
    read: () => this.read(),
    readAll: () => this.readAll(),
  };

  private read(): Promise<string | null> {
    if (this.buffer.length > 0) {
      return Promise.resolve(this.buffer.shift()!);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      this.waiting = resolve;
    });
  }

  private async readAll(): Promise<string> {
    const parts: string[] = [];
    while (true) {
      const chunk = await this.read();
      if (chunk === null) break;
      parts.push(chunk);
    }
    return parts.join('');
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(null);
    }
  }
}
