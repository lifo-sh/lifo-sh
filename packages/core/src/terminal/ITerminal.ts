export interface ITerminal {
  write(data: string): void;
  writeln(data: string): void;
  onData(callback: (data: string) => void): void;
  readonly cols: number;
  readonly rows: number;
  focus(): void;
  clear(): void;
}
