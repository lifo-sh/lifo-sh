import type { CommandInputStream } from '../commands/types.js';

/**
 * A bridge between terminal keyboard input and command stdin.
 * The Shell feeds lines in via feed(), commands consume via read()/readAll().
 */
export class TerminalStdin implements CommandInputStream {
  private buffer: string[] = [];
  private closed = false;
  private resolver: ((value: string | null) => void) | null = null;
  private _waiting = false;

  /** True when a command has called read() and is waiting for input. */
  get isWaiting(): boolean {
    return this._waiting;
  }

  /** Shell calls this on Enter (with line + '\n'). */
  feed(text: string): void {
    if (this.closed) return;

    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      this._waiting = false;
      resolve(text);
    } else {
      this.buffer.push(text);
    }
  }

  /** Shell calls this on Ctrl+D to signal EOF. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      this._waiting = false;
      resolve(null);
    }
  }

  /** Commands consume input. Returns null on EOF. */
  async read(): Promise<string | null> {
    if (this.buffer.length > 0) {
      return this.buffer.shift()!;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<string | null>((resolve) => {
      this.resolver = resolve;
      this._waiting = true;
    });
  }

  /** Read all remaining input until EOF, joined together. */
  async readAll(): Promise<string> {
    const parts: string[] = [];
    while (true) {
      const chunk = await this.read();
      if (chunk === null) break;
      parts.push(chunk);
    }
    return parts.join('');
  }
}
