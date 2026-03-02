/**
 * DaemonTerminal.ts — ITerminal implementation for the background daemon process
 *
 * When a lifo VM runs as a daemon (no attached terminal), this class acts as
 * the "screen" that the Shell writes to and reads from. Instead of talking to
 * a real TTY it talks to Unix socket clients.
 *
 * Multiple clients can be attached simultaneously (e.g. two terminal tabs both
 * running `lifo attach <id>`). All clients see the same shell output, and any
 * client's keystrokes are forwarded into the shell.
 *
 * Wire protocol (newline-delimited JSON over the Unix socket):
 *
 *   Client → Daemon:
 *     { "type": "input",  "data": "<raw keypress string>" }
 *     { "type": "resize", "cols": 120, "rows": 40 }
 *
 *   Daemon → Client:
 *     { "type": "output", "data": "<terminal output string>" }
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import type { ITerminal } from '@lifo-sh/core';

/** Maximum per-client lineBuffer size (1 MB). Client is dropped on overflow. */
const MAX_LINE_BUFFER = 1024 * 1024;

/** Maximum number of NDJSON lines to keep in the output log. */
const MAX_LOG_LINES = 1000;

/** Internal representation of one connected attach client. */
interface DaemonClient {
  socket: net.Socket;
  /** Last known terminal width reported by this client via a resize event. */
  cols: number;
  /** Last known terminal height reported by this client via a resize event. */
  rows: number;
}

export class DaemonTerminal implements ITerminal {
  /** Callbacks registered by the Shell via onData() — called on every keypress. */
  private dataCallbacks: Array<(data: string) => void> = [];

  /** Currently connected attach clients. */
  private clients: Set<DaemonClient> = new Set();

  /** Callback invoked when a client sends { type: "snapshot" }. */
  private snapshotCallback: ((socket: net.Socket) => void) | undefined;

  /** Terminal dimensions — kept in sync with the first connected client. */
  private _cols: number = 80;
  private _rows: number = 24;

  /**
   * Path to the NDJSON output log file (~/.lifo/sessions/<id>.output).
   * Each flushed entry: { "ts": "<ISO>", "data": "<raw terminal chunk>" }
   * Undefined when logging is disabled (e.g. in tests or interactive mode).
   */
  private logPath: string | undefined;

  /**
   * Pending output that hasn't been flushed to disk yet.
   * Batched for 50 ms to avoid a disk write on every single character echo.
   */
  private logBuffer: string = '';
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(logPath?: string) {
    this.logPath = logPath;
  }

  /**
   * Registers a new socket client (called by the daemon's net.Server on each
   * incoming connection from `lifo attach`).
   *
   * Sets up the data pipeline:
   *   socket bytes → JSON parse → input/resize handling
   * and auto-removes the client when the socket closes.
   */
  addClient(socket: net.Socket): void {
    const client: DaemonClient = { socket, cols: this._cols, rows: this._rows };
    this.clients.add(client);

    // Buffer for incomplete JSON lines arriving in chunks.
    let lineBuffer = '';

    socket.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      // Guard against a misbehaving client sending oversized messages.
      if (lineBuffer.length > MAX_LINE_BUFFER) {
        socket.destroy();
        return;
      }
      // Messages are newline-delimited — process every complete line.
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? ''; // last element is the incomplete tail
      for (const line of lines) {
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'snapshot') {
            // One-shot snapshot request — invoke the registered callback with
            // this socket so the daemon can write the snapshot-data response.
            // Do NOT add this socket as a regular client.
            this.clients.delete(client);
            this.snapshotCallback?.(socket);
            return;
          } else if (msg.type === 'input') {
            // Split the raw input into individual keypresses and feed each
            // one to the shell — matching the per-keypress contract the Shell
            // expects (same behaviour as NodeTerminal).
            const chunks = this.splitInput(msg.data);
            for (const c of chunks) {
              for (const cb of this.dataCallbacks) {
                cb(c);
              }
            }
          } else if (msg.type === 'resize') {
            client.cols = msg.cols;
            client.rows = msg.rows;
            // Use the first client's dimensions as the canonical terminal size.
            // (Multi-client resize is a known limitation — last writer wins in
            // practice but we keep it simple for now.)
            const first = [...this.clients][0];
            if (first === client) {
              this._cols = msg.cols;
              this._rows = msg.rows;
            }
          }
        } catch {
          // Ignore malformed / incomplete JSON messages.
        }
      }
    });

    // Clean up when the client disconnects (Ctrl+D, `exit`, or network error).
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  /**
   * Broadcasts a string of terminal output to every connected client
   * and appends it to the on-disk output log.
   * Each socket message is a single JSON line: { type: "output", data: "..." }
   */
  write(data: string): void {
    const msg = JSON.stringify({ type: 'output', data }) + '\n';
    for (const client of this.clients) {
      try {
        client.socket.write(msg);
      } catch {
        // The socket may have died between the liveness check and the write —
        // silently ignore; the close/error handlers will remove it.
      }
    }
    this.bufferLog(data);
  }

  /**
   * Accumulates output data and schedules a single disk flush after 50 ms of
   * inactivity. Batching avoids a syscall per character echo while still
   * delivering frequent-enough entries for a live log view.
   */
  private bufferLog(data: string): void {
    if (!this.logPath) return;
    this.logBuffer += data;
    if (this.logFlushTimer) return;
    this.logFlushTimer = setTimeout(() => {
      this.logFlushTimer = null;
      const chunk = this.logBuffer;
      this.logBuffer = '';
      if (!chunk) return;
      const line = JSON.stringify({ ts: new Date().toISOString(), data: chunk }) + '\n';
      fs.appendFile(this.logPath!, line, () => {
        this.trimLogIfNeeded();
      });
    }, 50);
  }

  /**
   * Trims the output log to MAX_LOG_LINES by dropping the oldest entries.
   * Called after each flush. Reads the whole file only when it exceeds the
   * limit, so the overhead is negligible during normal operation.
   */
  private trimLogIfNeeded(): void {
    if (!this.logPath) return;
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length <= MAX_LOG_LINES) return;
      // Keep the newest MAX_LOG_LINES entries.
      const trimmed = lines.slice(-MAX_LOG_LINES).join('\n') + '\n';
      fs.writeFileSync(this.logPath, trimmed);
    } catch { /* best-effort */ }
  }

  writeln(data: string): void {
    this.write(data + '\r\n');
  }

  /** Registers a callback that fires for every keypress from any client. */
  onData(callback: (data: string) => void): void {
    this.dataCallbacks.push(callback);
  }

  /** Registers a callback invoked when a client sends { type: "snapshot" }. */
  onSnapshot(callback: (socket: net.Socket) => void): void {
    this.snapshotCallback = callback;
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  /**
   * Forcibly disconnects all attached clients without shutting down the daemon.
   * Called when the user types `exit` inside the shell — we drop the clients
   * (sending them back to their host shell) but keep the VM alive so it can
   * be re-attached later with `lifo attach <id>`.
   */
  disconnectAllClients(): void {
    for (const client of this.clients) {
      try { client.socket.destroy(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  focus(): void {
    // No-op: the daemon process has no display of its own.
  }

  clear(): void {
    this.write('\x1b[2J\x1b[H');
  }

  /**
   * Splits a raw input string into individual keypresses / ANSI escape sequences.
   *
   * The Shell expects one logical keypress per onData() call (matching the
   * behaviour of xterm.js in the browser). Node.js stdin — and our socket
   * protocol — can batch multiple characters in a single chunk, so we split
   * them here. The same logic lives in NodeTerminal for the interactive case.
   *
   * Recognised sequence types:
   *   \x1b[...  — CSI sequence (arrow keys, function keys, etc.)
   *   \x1bO...  — SS3 sequence (numpad / function keys on some terminals)
   *   \x1b<c>   — Alt+key
   *   <c>       — Single printable or control character
   */
  private splitInput(data: string): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === '\x1b') {
        let end = i + 1;
        if (end < data.length && data[end] === '[') {
          // CSI sequence: \x1b[ + parameter bytes (0x30–0x3f) + final byte
          end++;
          while (end < data.length && data.charCodeAt(end) >= 0x30 && data.charCodeAt(end) <= 0x3f) {
            end++;
          }
          if (end < data.length) end++; // consume the final byte
        } else if (end < data.length && data[end] === 'O') {
          // SS3 sequence: \x1bO + one character
          end++;
          if (end < data.length) end++;
        } else if (end < data.length) {
          // Alt+key: \x1b + single character
          end++;
        }
        chunks.push(data.slice(i, end));
        i = end;
      } else {
        // Regular printable or control character (e.g. Enter = \r, Ctrl+C = \x03)
        chunks.push(data[i]!);
        i++;
      }
    }
    return chunks;
  }
}
