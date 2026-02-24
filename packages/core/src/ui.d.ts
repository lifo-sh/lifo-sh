/**
 * Type declaration for optional @lifo-sh/ui dynamic import.
 * This avoids a build-order dependency: core builds before ui,
 * but Sandbox.ts dynamically imports Terminal from ui.
 */
declare module '@lifo-sh/ui' {
  import type { ITerminal } from './terminal/ITerminal.js';

  export class Terminal implements ITerminal {
    constructor(container: HTMLElement);
    write(data: string): void;
    writeln(data: string): void;
    onData(callback: (data: string) => void): void;
    readonly cols: number;
    readonly rows: number;
    focus(): void;
    clear(): void;
  }

  export type { ITerminal };
}
