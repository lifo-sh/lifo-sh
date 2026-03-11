import type { IKernel, IKernelVfs } from '@lifo-sh/kernel';

export interface CommandOutputStream {
  write(text: string): void;
}

export interface CommandInputStream {
  read(): Promise<string | null>;   // null = EOF
  readAll(): Promise<string>;
}

export interface CommandContext {
  kernel: IKernel;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  vfs: IKernelVfs;
  stdout: CommandOutputStream;
  stderr: CommandOutputStream;
  signal: AbortSignal;
  stdin?: CommandInputStream;
  setRawMode?: (enabled: boolean) => void;
}

export type Command = (ctx: CommandContext) => Promise<number>;
