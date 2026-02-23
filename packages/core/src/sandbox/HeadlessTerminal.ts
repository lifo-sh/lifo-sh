/**
 * A Terminal-shaped class that captures output without xterm.js.
 * Used for headless/programmatic Sandbox usage (AI agents, tests, etc.)
 */
export class HeadlessTerminal {
  private dataCallback: ((data: string) => void) | null = null;

  write(_data: string): void {
    // Headless mode: discard visual output
  }

  writeln(_data: string): void {
    // Headless mode: discard visual output
  }

  onData(cb: (data: string) => void): void {
    this.dataCallback = cb;
  }

  get cols(): number {
    return 80;
  }

  get rows(): number {
    return 24;
  }

  focus(): void {}

  clear(): void {}

  /** Send data as if typed on keyboard (used internally for stdin) */
  sendData(data: string): void {
    this.dataCallback?.(data);
  }
}
