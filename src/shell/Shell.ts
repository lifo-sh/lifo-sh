import type { Terminal } from '../terminal/Terminal.js';
import type { VFS } from '../kernel/vfs/index.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandOutputStream } from '../commands/types.js';
import { resolve } from '../utils/path.js';
import { BOLD, GREEN, BLUE, RESET } from '../utils/colors.js';
import { VFSError } from '../kernel/vfs/index.js';
import { Interpreter, type BuiltinFn } from './interpreter.js';
import { HistoryManager } from './history.js';
import { JobTable } from './jobs.js';
import { complete, type CompletionContext } from './completer.js';
import { evaluateTest } from './test-builtin.js';

export class Shell {
  private terminal: Terminal;
  private vfs: VFS;
  private registry: CommandRegistry;
  private cwd: string;
  private env: Record<string, string>;

  // Alias map
  private aliases = new Map<string, string>();

  // Line editing state
  private lineBuffer: string = '';
  private cursorPos: number = 0;

  // History (legacy array kept for backward compat with tests)
  private history: string[] = [];
  private historyIndex: number = -1;
  private savedLine: string = '';

  // Running command
  private running: boolean = false;
  private abortController: AbortController | null = null;

  // New Sprint 2 components
  private interpreter: Interpreter;
  private historyManager: HistoryManager;
  private jobTable: JobTable;
  private builtins: Map<string, BuiltinFn>;

  // Tab completion state
  private tabCount: number = 0;

  constructor(
    terminal: Terminal,
    vfs: VFS,
    registry: CommandRegistry,
    env: Record<string, string>,
  ) {
    this.terminal = terminal;
    this.vfs = vfs;
    this.registry = registry;
    this.cwd = env['HOME'] ?? '/home/user';
    this.env = { ...env };

    // Initialize builtins
    this.builtins = new Map<string, BuiltinFn>();
    this.registerBuiltins();

    // Initialize job table
    this.jobTable = new JobTable();

    // Initialize history manager
    this.historyManager = new HistoryManager(vfs);
    this.historyManager.load();

    // Initialize interpreter
    this.interpreter = new Interpreter({
      env: this.env,
      getCwd: () => this.cwd,
      setCwd: (cwd: string) => { this.cwd = cwd; },
      vfs: this.vfs,
      registry: this.registry,
      builtins: this.builtins,
      jobTable: this.jobTable,
      writeToTerminal: (text: string) => this.writeToTerminal(text),
      aliases: this.aliases,
    });
  }

  private registerBuiltins(): void {
    this.builtins.set('cd', (args, _stdout, stderr) => this.builtinCd(args, stderr));
    this.builtins.set('pwd', (_args, stdout) => this.builtinPwd(stdout));
    this.builtins.set('echo', (args, stdout) => this.builtinEcho(args, stdout));
    this.builtins.set('clear', () => this.builtinClear());
    this.builtins.set('export', (args) => this.builtinExport(args));
    this.builtins.set('exit', (_args, stdout) => this.builtinExit(stdout));
    this.builtins.set('true', () => Promise.resolve(0));
    this.builtins.set('false', () => Promise.resolve(1));
    this.builtins.set('jobs', (_args, stdout) => this.builtinJobs(stdout));
    this.builtins.set('fg', (args, stdout, stderr) => this.builtinFg(args, stdout, stderr));
    this.builtins.set('bg', (args, stdout, stderr) => this.builtinBg(args, stdout, stderr));
    this.builtins.set('history', (_args, stdout) => this.builtinHistory(stdout));
    this.builtins.set('source', (args, _stdout, stderr) => this.builtinSource(args, stderr));
    this.builtins.set('.', (args, _stdout, stderr) => this.builtinSource(args, stderr));
    this.builtins.set('alias', (args, stdout) => this.builtinAlias(args, stdout));
    this.builtins.set('unalias', (args, _stdout, stderr) => this.builtinUnalias(args, stderr));
    this.builtins.set('test', (_args, _stdout, stderr) =>
      Promise.resolve(evaluateTest(_args, this.vfs, stderr)));
    this.builtins.set('[', (_args, _stdout, stderr) =>
      Promise.resolve(evaluateTest(_args, this.vfs, stderr)));
  }

  getJobTable(): JobTable {
    return this.jobTable;
  }

  start(): void {
    this.terminal.onData((data) => this.handleInput(data));
    this.printPrompt();
  }

  private printPrompt(): void {
    // Report finished background jobs
    const doneJobs = this.jobTable.collectDone();
    for (const job of doneJobs) {
      this.writeToTerminal(`[${job.id}] Done    ${job.command}\n`);
    }

    const home = this.env['HOME'] ?? '/home/user';
    let displayPath = this.cwd;
    if (this.cwd === home) {
      displayPath = '~';
    } else if (this.cwd.startsWith(home + '/')) {
      displayPath = '~' + this.cwd.slice(home.length);
    }

    const user = this.env['USER'] ?? 'user';
    const host = this.env['HOSTNAME'] ?? 'browseros';
    this.terminal.write(`${BOLD}${GREEN}${user}@${host}${RESET}:${BOLD}${BLUE}${displayPath}${RESET}$ `);
  }

  private handleInput(data: string): void {
    // ESC sequences
    if (data === '\x1b[D') { this.moveCursorLeft(); return; }
    if (data === '\x1b[C') { this.moveCursorRight(); return; }
    if (data === '\x1b[A') { this.historyUp(); return; }
    if (data === '\x1b[B') { this.historyDown(); return; }
    if (data === '\x1b[H' || data === '\x01') { this.moveCursorHome(); return; } // Home / Ctrl+A
    if (data === '\x1b[F' || data === '\x05') { this.moveCursorEnd(); return; }  // End / Ctrl+E

    // Ctrl+C
    if (data === '\x03') {
      if (this.running && this.abortController) {
        this.abortController.abort();
      } else {
        this.terminal.write('^C\r\n');
        this.lineBuffer = '';
        this.cursorPos = 0;
        this.printPrompt();
      }
      return;
    }

    // Ctrl+U -- clear line
    if (data === '\x15') {
      this.clearLine();
      this.lineBuffer = '';
      this.cursorPos = 0;
      return;
    }

    if (this.running) return;

    // Tab completion
    if (data === '\t') {
      this.handleTab();
      return;
    }

    // Reset tab state on any non-tab input
    this.tabCount = 0;

    // Enter
    if (data === '\r') {
      this.terminal.write('\r\n');
      const line = this.lineBuffer.trim();
      this.lineBuffer = '';
      this.cursorPos = 0;
      this.historyIndex = -1;

      if (line) {
        this.history.push(line);
        this.executeLine(line);
      } else {
        this.printPrompt();
      }
      return;
    }

    // Backspace
    if (data === '\x7f' || data === '\b') {
      if (this.cursorPos > 0) {
        const before = this.lineBuffer.slice(0, this.cursorPos - 1);
        const after = this.lineBuffer.slice(this.cursorPos);
        this.lineBuffer = before + after;
        this.cursorPos--;
        this.redrawLine();
      }
      return;
    }

    // Delete
    if (data === '\x1b[3~') {
      if (this.cursorPos < this.lineBuffer.length) {
        const before = this.lineBuffer.slice(0, this.cursorPos);
        const after = this.lineBuffer.slice(this.cursorPos + 1);
        this.lineBuffer = before + after;
        this.redrawLine();
      }
      return;
    }

    // Printable characters
    if (data >= ' ') {
      // Insert at cursor
      const before = this.lineBuffer.slice(0, this.cursorPos);
      const after = this.lineBuffer.slice(this.cursorPos);
      this.lineBuffer = before + data + after;
      this.cursorPos += data.length;
      this.redrawLine();
    }
  }

  private handleTab(): void {
    const completionCtx: CompletionContext = {
      line: this.lineBuffer,
      cursorPos: this.cursorPos,
      cwd: this.cwd,
      env: this.env,
      vfs: this.vfs,
      registry: this.registry,
      builtinNames: [...this.builtins.keys()],
    };

    const result = complete(completionCtx);
    const currentWord = this.lineBuffer.slice(result.replacementStart, result.replacementEnd);

    if (result.completions.length === 0) {
      // No completions -- bell
      this.terminal.write('\x07');
      return;
    }

    if (result.completions.length === 1) {
      // Single completion -- insert it
      const completion = result.completions[0];
      const suffix = completion.endsWith('/') ? '' : ' ';
      this.applyCompletion(result.replacementStart, result.replacementEnd, completion + suffix);
      this.tabCount = 0;
      return;
    }

    // Multiple completions
    if (result.commonPrefix.length > currentWord.length) {
      // Extend to common prefix
      this.applyCompletion(result.replacementStart, result.replacementEnd, result.commonPrefix);
      this.tabCount = 0;
      return;
    }

    // Same word as before -- second tab shows all completions
    this.tabCount++;
    if (this.tabCount >= 2) {
      this.terminal.write('\r\n');
      this.writeToTerminal(result.completions.join('  ') + '\n');
      this.printPrompt();
      this.terminal.write(this.lineBuffer);
      // Move cursor to correct position
      const diff = this.lineBuffer.length - this.cursorPos;
      if (diff > 0) {
        this.terminal.write(`\x1b[${diff}D`);
      }
      this.tabCount = 0;
    }
  }

  private applyCompletion(start: number, end: number, text: string): void {
    const before = this.lineBuffer.slice(0, start);
    const after = this.lineBuffer.slice(end);
    this.lineBuffer = before + text + after;
    this.cursorPos = start + text.length;
    this.redrawLine();
  }

  private clearLine(): void {
    // Move to start of input, clear to end of line
    if (this.cursorPos > 0) {
      this.terminal.write(`\x1b[${this.cursorPos}D`);
    }
    this.terminal.write('\x1b[K');
  }

  private redrawLine(): void {
    // Save cursor, move to start of input area, clear, rewrite, restore cursor
    // Move cursor to start of input (back by old visual cursor pos is tricky, so just use \r and rewrite prompt)
    this.terminal.write('\r');
    // Rewrite prompt
    const home = this.env['HOME'] ?? '/home/user';
    let displayPath = this.cwd;
    if (this.cwd === home) {
      displayPath = '~';
    } else if (this.cwd.startsWith(home + '/')) {
      displayPath = '~' + this.cwd.slice(home.length);
    }
    const user = this.env['USER'] ?? 'user';
    const host = this.env['HOSTNAME'] ?? 'browseros';
    this.terminal.write(`${BOLD}${GREEN}${user}@${host}${RESET}:${BOLD}${BLUE}${displayPath}${RESET}$ `);
    this.terminal.write(this.lineBuffer);
    this.terminal.write('\x1b[K'); // Clear anything after

    // Move cursor to correct position
    const diff = this.lineBuffer.length - this.cursorPos;
    if (diff > 0) {
      this.terminal.write(`\x1b[${diff}D`);
    }
  }

  private moveCursorLeft(): void {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      this.terminal.write('\x1b[D');
    }
  }

  private moveCursorRight(): void {
    if (this.cursorPos < this.lineBuffer.length) {
      this.cursorPos++;
      this.terminal.write('\x1b[C');
    }
  }

  private moveCursorHome(): void {
    if (this.cursorPos > 0) {
      this.terminal.write(`\x1b[${this.cursorPos}D`);
      this.cursorPos = 0;
    }
  }

  private moveCursorEnd(): void {
    const diff = this.lineBuffer.length - this.cursorPos;
    if (diff > 0) {
      this.terminal.write(`\x1b[${diff}C`);
      this.cursorPos = this.lineBuffer.length;
    }
  }

  private historyUp(): void {
    if (this.history.length === 0) return;

    if (this.historyIndex === -1) {
      this.savedLine = this.lineBuffer;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      return;
    }

    this.lineBuffer = this.history[this.historyIndex];
    this.cursorPos = this.lineBuffer.length;
    this.redrawLine();
  }

  private historyDown(): void {
    if (this.historyIndex === -1) return;

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.lineBuffer = this.history[this.historyIndex];
    } else {
      this.historyIndex = -1;
      this.lineBuffer = this.savedLine;
    }

    this.cursorPos = this.lineBuffer.length;
    this.redrawLine();
  }

  private async executeLine(line: string): Promise<void> {
    // History expansion
    const expanded = this.historyManager.expand(line);
    const actualLine = expanded ?? line;

    if (expanded !== null) {
      // Show the expanded command
      this.writeToTerminal(actualLine + '\n');
    }

    // Add to history
    this.historyManager.add(actualLine);

    this.running = true;
    this.abortController = new AbortController();

    try {
      await this.interpreter.executeLine(actualLine);
    } finally {
      this.running = false;
      this.abortController = null;
    }

    this.printPrompt();
  }

  // ─── Builtins (now with stdout/stderr params for pipe support) ───

  private async builtinCd(args: string[], stderr: CommandOutputStream): Promise<number> {
    const target = args[0] ?? this.env['HOME'] ?? '/home/user';
    let newPath: string;

    if (target === '-') {
      newPath = this.env['OLDPWD'] ?? this.cwd;
    } else if (target === '~' || target.startsWith('~/')) {
      const home = this.env['HOME'] ?? '/home/user';
      newPath = target === '~' ? home : resolve(home, target.slice(2));
    } else {
      newPath = resolve(this.cwd, target);
    }

    try {
      const stat = this.vfs.stat(newPath);
      if (stat.type !== 'directory') {
        stderr.write(`cd: ${target}: Not a directory\n`);
        return 1;
      }
      this.env['OLDPWD'] = this.cwd;
      this.cwd = newPath;
      return 0;
    } catch (e) {
      if (e instanceof VFSError) {
        stderr.write(`cd: ${target}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  private async builtinPwd(stdout: CommandOutputStream): Promise<number> {
    stdout.write(this.cwd + '\n');
    return 0;
  }

  private async builtinEcho(args: string[], stdout: CommandOutputStream): Promise<number> {
    stdout.write(args.join(' ') + '\n');
    return 0;
  }

  private async builtinClear(): Promise<number> {
    this.terminal.clear();
    return 0;
  }

  private async builtinExport(args: string[]): Promise<number> {
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(0, eqIdx);
        const value = arg.slice(eqIdx + 1);
        this.env[key] = value;
      }
    }
    return 0;
  }

  private async builtinExit(stdout: CommandOutputStream): Promise<number> {
    stdout.write('logout\n');
    return 0;
  }

  private async builtinJobs(stdout: CommandOutputStream): Promise<number> {
    const jobs = this.jobTable.list();
    for (const job of jobs) {
      stdout.write(`[${job.id}] ${job.status}    ${job.command}\n`);
    }
    return 0;
  }

  private async builtinFg(args: string[], stdout: CommandOutputStream, stderr: CommandOutputStream): Promise<number> {
    const id = args[0] ? parseInt(args[0], 10) : undefined;
    const jobs = this.jobTable.list();

    if (jobs.length === 0) {
      stderr.write('fg: no current job\n');
      return 1;
    }

    const job = id ? this.jobTable.get(id) : jobs[jobs.length - 1];
    if (!job) {
      stderr.write(`fg: ${id}: no such job\n`);
      return 1;
    }

    stdout.write(`${job.command}\n`);
    const exitCode = await job.promise;
    this.jobTable.remove(job.id);
    return exitCode;
  }

  private async builtinBg(args: string[], stdout: CommandOutputStream, stderr: CommandOutputStream): Promise<number> {
    const id = args[0] ? parseInt(args[0], 10) : undefined;
    const jobs = this.jobTable.list();

    if (jobs.length === 0) {
      stderr.write('bg: no current job\n');
      return 1;
    }

    const job = id ? this.jobTable.get(id) : jobs[jobs.length - 1];
    if (!job) {
      stderr.write(`bg: ${id}: no such job\n`);
      return 1;
    }

    stdout.write(`[${job.id}] ${job.command} &\n`);
    return 0;
  }

  private async builtinHistory(stdout: CommandOutputStream): Promise<number> {
    const entries = this.historyManager.getAll();
    for (let i = 0; i < entries.length; i++) {
      stdout.write(`  ${i + 1}  ${entries[i]}\n`);
    }
    return 0;
  }

  async sourceFile(path: string): Promise<void> {
    try {
      const content = this.vfs.readFileString(path);
      await this.interpreter.executeLine(content);
    } catch {
      // Silently ignore missing config files
    }
  }

  private async builtinSource(args: string[], stderr: CommandOutputStream): Promise<number> {
    if (args.length === 0) {
      stderr.write('source: missing filename\n');
      return 1;
    }
    const path = resolve(this.cwd, args[0]);
    try {
      const content = this.vfs.readFileString(path);
      await this.interpreter.executeLine(content);
      return 0;
    } catch {
      stderr.write(`source: ${args[0]}: No such file\n`);
      return 1;
    }
  }

  private async builtinAlias(args: string[], stdout: CommandOutputStream): Promise<number> {
    if (args.length === 0) {
      for (const [name, value] of this.aliases) {
        stdout.write(`alias ${name}='${value}'\n`);
      }
      return 0;
    }

    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const name = arg.slice(0, eqIdx);
        const value = arg.slice(eqIdx + 1);
        this.aliases.set(name, value);
      } else {
        const value = this.aliases.get(arg);
        if (value !== undefined) {
          stdout.write(`alias ${arg}='${value}'\n`);
        } else {
          stdout.write(`alias: ${arg}: not found\n`);
        }
      }
    }
    return 0;
  }

  private async builtinUnalias(args: string[], stderr: CommandOutputStream): Promise<number> {
    if (args.length === 0) {
      stderr.write('unalias: usage: unalias name ...\n');
      return 1;
    }
    for (const name of args) {
      if (!this.aliases.delete(name)) {
        stderr.write(`unalias: ${name}: not found\n`);
      }
    }
    return 0;
  }

  private writeToTerminal(text: string): void {
    // Convert \n to \r\n for xterm.js
    const converted = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    this.terminal.write(converted);
  }

  // ─── Legacy Tokenizer (kept for backward compatibility) ───

  tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let i = 0;

    while (i < input.length) {
      const ch = input[i];

      if (inSingle) {
        if (ch === "'") {
          inSingle = false;
        } else {
          current += ch;
        }
        i++;
        continue;
      }

      if (inDouble) {
        if (ch === '"') {
          inDouble = false;
        } else {
          current += ch;
        }
        i++;
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        i++;
        continue;
      }

      if (ch === '"') {
        inDouble = true;
        i++;
        continue;
      }

      if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        i++;
        continue;
      }

      // Handle &&
      if (ch === '&' && input[i + 1] === '&') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        tokens.push('&&');
        i += 2;
        continue;
      }

      current += ch;
      i++;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }
}
