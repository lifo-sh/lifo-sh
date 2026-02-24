import type { ITerminal } from '@lifo-sh/core';

/**
 * ITerminal implementation that bridges to the host Node.js process's
 * stdin/stdout, enabling the lifo shell to run in a real terminal.
 *
 * Puts stdin into raw mode so individual keypresses (including escape
 * sequences for arrow keys, etc.) are forwarded directly to the Shell.
 *
 * Incoming data is split into individual keypresses / escape sequences
 * to match the per-keypress behavior of xterm.js that Shell expects.
 */
export class NodeTerminal implements ITerminal {
  private dataCallbacks: Array<(data: string) => void> = [];

  constructor() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (data: string) => {
      const chunks = this.splitInput(data);
      for (const chunk of chunks) {
        for (const cb of this.dataCallbacks) {
          cb(chunk);
        }
      }
    });
  }

  write(data: string): void {
    process.stdout.write(data);
  }

  writeln(data: string): void {
    process.stdout.write(data + '\r\n');
  }

  onData(callback: (data: string) => void): void {
    this.dataCallbacks.push(callback);
  }

  get cols(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  focus(): void {
    // No-op in Node.js — the host terminal is already focused
  }

  clear(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  destroy(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  /**
   * Split a data chunk into individual keypresses / escape sequences.
   * The Shell expects one keypress per onData callback (matching xterm.js),
   * but Node.js stdin can batch multiple characters together.
   */
  private splitInput(data: string): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === '\x1b') {
        // Escape sequence
        let end = i + 1;
        if (end < data.length && data[end] === '[') {
          end++;
          // CSI sequence: \x1b[ + optional params (0-9;) + final byte
          while (end < data.length && data.charCodeAt(end) >= 0x30 && data.charCodeAt(end) <= 0x3f) {
            end++;
          }
          // Include the final character (A-Z, a-z, ~, etc.)
          if (end < data.length) {
            end++;
          }
        } else if (end < data.length && data[end] === 'O') {
          // SS3 sequence: \x1bO + char (e.g., \x1bOP for F1)
          end++;
          if (end < data.length) {
            end++;
          }
        } else if (end < data.length) {
          // Alt+key: \x1b + char
          end++;
        }
        chunks.push(data.slice(i, end));
        i = end;
      } else {
        // Single character (printable or control)
        chunks.push(data[i]);
        i++;
      }
    }
    return chunks;
  }
}
