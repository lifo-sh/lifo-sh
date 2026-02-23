import type { VFS } from '../kernel/vfs/index.js';

export interface CommandOutputStream {
  write(text: string): void;
}

export interface CommandInputStream {
  read(): Promise<string | null>;   // null = EOF
  readAll(): Promise<string>;
}

export interface CommandContext {
  args: string[];
  env: Record<string, string>;
  cwd: string;
  vfs: VFS;
  stdout: CommandOutputStream;
  stderr: CommandOutputStream;
  signal: AbortSignal;
  stdin?: CommandInputStream;
}

export type Command = (ctx: CommandContext) => Promise<number>;
