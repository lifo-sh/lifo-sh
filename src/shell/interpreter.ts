import type {
  ScriptNode,
  ListNode,
  PipelineNode,
  SimpleCommandNode,
  CompoundCommandNode,
  IfNode,
  ForNode,
  WhileNode,
  UntilNode,
  CaseNode,
  FunctionDefNode,
  GroupNode,
} from './types.js';
import type { VFS } from '../kernel/vfs/index.js';
import type { CommandRegistry } from '../commands/registry.js';
import type {
  CommandOutputStream,
  CommandInputStream,
  CommandContext,
} from '../commands/types.js';
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { expandWords, expandWord, type ExpandContext } from './expander.js';
import { PipeChannel } from './pipe.js';
import { JobTable } from './jobs.js';
import { resolve } from '../utils/path.js';
import { globMatch } from '../utils/glob.js';

// ─── Signal classes for control flow ───

export class BreakSignal {
  constructor(public levels: number) {}
}

export class ContinueSignal {
  constructor(public levels: number) {}
}

export class ReturnSignal {
  constructor(public exitCode: number) {}
}

export type BuiltinFn = (
  args: string[],
  stdout: CommandOutputStream,
  stderr: CommandOutputStream,
  stdin?: CommandInputStream,
) => Promise<number>;

export interface InterpreterConfig {
  env: Record<string, string>;
  getCwd: () => string;
  setCwd: (cwd: string) => void;
  vfs: VFS;
  registry: CommandRegistry;
  builtins: Map<string, BuiltinFn>;
  jobTable: JobTable;
  writeToTerminal: (text: string) => void;
  aliases?: Map<string, string>;
}

export class Interpreter {
  private config: InterpreterConfig;
  private lastExitCode = 0;
  private functions = new Map<string, CompoundCommandNode>();

  constructor(config: InterpreterConfig) {
    this.config = config;
  }

  getLastExitCode(): number {
    return this.lastExitCode;
  }

  async executeScript(script: ScriptNode): Promise<number> {
    let exitCode = 0;
    for (const list of script.lists) {
      exitCode = await this.executeList(list);
    }
    this.lastExitCode = exitCode;
    return exitCode;
  }

  async executeLine(input: string): Promise<number> {
    try {
      const tokens = lex(input);
      const script = parse(tokens);
      return await this.executeScript(script);
    } catch (e) {
      if (e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ReturnSignal) {
        throw e;
      }
      if (e instanceof Error) {
        this.config.writeToTerminal(`${e.message}\n`);
      }
      this.lastExitCode = 2;
      return 2;
    }
  }

  private async executeList(list: ListNode): Promise<number> {
    if (list.background) {
      const abortController = new AbortController();
      const commandText = this.getListCommandText(list);

      const promise = this.executeListEntries(list.entries);
      const jobId = this.config.jobTable.add(commandText, promise, abortController);
      this.config.writeToTerminal(`[${jobId}] (background)\n`);
      return 0;
    }

    return this.executeListEntries(list.entries);
  }

  private getListCommandText(list: ListNode): string {
    return list.entries.map((e) =>
      e.pipeline.commands.map((c) => {
        if (c.type === 'simple_command') {
          return c.words.map((w) => w.map((p) => p.text).join('')).join(' ');
        }
        return c.type;
      }).join(' | '),
    ).join(' ');
  }

  private async executeListEntries(entries: ListNode['entries']): Promise<number> {
    let exitCode = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      exitCode = await this.executePipeline(entry.pipeline);

      // Check the connector on current entry to decide whether to continue
      if (entry.connector === '&&' && exitCode !== 0) {
        // Skip remaining entries until we find || or end
        break;
      }
      if (entry.connector === '||' && exitCode === 0) {
        // Skip remaining entries until we find && or end
        break;
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executePipeline(pipeline: PipelineNode): Promise<number> {
    const commands = pipeline.commands;

    let exitCode: number;

    if (commands.length === 1) {
      // Single command -- no piping needed
      exitCode = await this.executeCommand(commands[0]);
    } else {
      // Multi-command pipeline
      exitCode = await this.executePipelineCommands(commands);
    }

    if (pipeline.negated) {
      exitCode = exitCode === 0 ? 1 : 0;
    }

    return exitCode;
  }

  private async executePipelineCommands(commands: CompoundCommandNode[]): Promise<number> {
    const pipes: PipeChannel[] = [];
    const promises: Promise<number>[] = [];

    for (let i = 0; i < commands.length; i++) {
      const stdin = i > 0 ? pipes[i - 1].reader : undefined;
      let stdout: CommandOutputStream | undefined;

      if (i < commands.length - 1) {
        const pipe = new PipeChannel();
        pipes.push(pipe);
        stdout = pipe.writer;
      }

      const cmd = commands[i];
      const cmdPromise = this.executeCommand(cmd, stdin, stdout)
        .then((code) => {
          // Close the pipe writer when command finishes
          if (i < commands.length - 1) {
            pipes[i].close();
          }
          return code;
        });

      promises.push(cmdPromise);
    }

    const results = await Promise.all(promises);
    return results[results.length - 1];
  }

  private async executeCommand(
    cmd: CompoundCommandNode,
    pipeStdin?: CommandInputStream,
    pipeStdout?: CommandOutputStream,
  ): Promise<number> {
    switch (cmd.type) {
      case 'simple_command':
        return this.executeSimpleCommand(cmd, pipeStdin, pipeStdout);
      case 'if':
        return this.executeIf(cmd, pipeStdout);
      case 'for':
        return this.executeFor(cmd, pipeStdout);
      case 'while':
        return this.executeWhile(cmd, pipeStdout);
      case 'until':
        return this.executeUntil(cmd, pipeStdout);
      case 'case':
        return this.executeCase(cmd, pipeStdout);
      case 'group':
        return this.executeGroup(cmd, pipeStdout);
      case 'function_def':
        return this.executeFunctionDef(cmd);
    }
  }

  private async executeIf(node: IfNode, pipeStdout?: CommandOutputStream): Promise<number> {
    let exitCode = 0;

    for (const clause of node.clauses) {
      const condCode = await this.executeCompoundList(clause.condition, pipeStdout);
      if (condCode === 0) {
        exitCode = await this.executeCompoundList(clause.body, pipeStdout);
        this.lastExitCode = exitCode;
        return exitCode;
      }
    }

    if (node.elseBody) {
      exitCode = await this.executeCompoundList(node.elseBody, pipeStdout);
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeFor(node: ForNode, pipeStdout?: CommandOutputStream): Promise<number> {
    const expandCtx = this.createExpandContext();
    let exitCode = 0;

    let values: string[];
    if (node.words !== null) {
      values = await expandWords(node.words, expandCtx);
    } else {
      // Use "$@"
      const atVal = this.config.env['@'] ?? '';
      values = atVal ? atVal.split(' ') : [];
    }

    for (const val of values) {
      this.config.env[node.variable] = val;
      try {
        exitCode = await this.executeCompoundList(node.body, pipeStdout);
      } catch (e) {
        if (e instanceof BreakSignal) {
          if (e.levels > 1) throw new BreakSignal(e.levels - 1);
          break;
        }
        if (e instanceof ContinueSignal) {
          if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
          continue;
        }
        throw e;
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeWhile(node: WhileNode, pipeStdout?: CommandOutputStream): Promise<number> {
    let exitCode = 0;

    while (true) {
      const condCode = await this.executeCompoundList(node.condition, pipeStdout);
      if (condCode !== 0) break;

      try {
        exitCode = await this.executeCompoundList(node.body, pipeStdout);
      } catch (e) {
        if (e instanceof BreakSignal) {
          if (e.levels > 1) throw new BreakSignal(e.levels - 1);
          break;
        }
        if (e instanceof ContinueSignal) {
          if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
          continue;
        }
        throw e;
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeUntil(node: UntilNode, pipeStdout?: CommandOutputStream): Promise<number> {
    let exitCode = 0;

    while (true) {
      const condCode = await this.executeCompoundList(node.condition, pipeStdout);
      if (condCode === 0) break;

      try {
        exitCode = await this.executeCompoundList(node.body, pipeStdout);
      } catch (e) {
        if (e instanceof BreakSignal) {
          if (e.levels > 1) throw new BreakSignal(e.levels - 1);
          break;
        }
        if (e instanceof ContinueSignal) {
          if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
          continue;
        }
        throw e;
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeCase(node: CaseNode, pipeStdout?: CommandOutputStream): Promise<number> {
    const expandCtx = this.createExpandContext();
    const wordValue = await expandWord(node.word, expandCtx);
    let exitCode = 0;

    for (const item of node.items) {
      for (const pattern of item.patterns) {
        const patternValue = await expandWord(pattern, expandCtx);
        if (globMatch(patternValue, wordValue)) {
          exitCode = await this.executeCompoundList(item.body, pipeStdout);
          this.lastExitCode = exitCode;
          return exitCode;
        }
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeFunctionDef(node: FunctionDefNode): Promise<number> {
    this.functions.set(node.name, node.body);
    return 0;
  }

  private async executeGroup(node: GroupNode, pipeStdout?: CommandOutputStream): Promise<number> {
    const exitCode = await this.executeCompoundList(node.body, pipeStdout);
    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeCompoundList(lists: ListNode[], _pipeStdout?: CommandOutputStream): Promise<number> {
    let exitCode = 0;
    for (const list of lists) {
      exitCode = await this.executeList(list);
    }
    return exitCode;
  }

  private async executeSimpleCommand(
    cmd: SimpleCommandNode,
    pipeStdin?: CommandInputStream,
    pipeStdout?: CommandOutputStream,
  ): Promise<number> {
    const expandCtx = this.createExpandContext();

    // Expand words
    const expandedArgs = await expandWords(cmd.words, expandCtx);
    if (expandedArgs.length === 0 && cmd.assignments.length > 0) {
      // Bare assignment -- set env vars
      for (const assign of cmd.assignments) {
        const value = await expandWord(assign.value, expandCtx);
        this.config.env[assign.name] = value;
      }
      return 0;
    }

    if (expandedArgs.length === 0) {
      return 0;
    }

    const [name, ...args] = expandedArgs;

    // Check alias expansion
    const aliases = this.config.aliases;
    if (aliases) {
      const aliasValue = aliases.get(name);
      if (aliasValue !== undefined) {
        // Rebuild the command line with the alias expanded
        const expandedLine = aliasValue + (args.length > 0 ? ' ' + args.join(' ') : '');
        return this.executeLine(expandedLine);
      }
    }

    // Apply per-command assignments (temporary env)
    const savedEnv: Record<string, string | undefined> = {};
    for (const assign of cmd.assignments) {
      const value = await expandWord(assign.value, expandCtx);
      savedEnv[assign.name] = this.config.env[assign.name];
      this.config.env[assign.name] = value;
    }

    // Set up stdout/stderr (default to terminal)
    let stdout: CommandOutputStream = pipeStdout ?? {
      write: (text: string) => this.config.writeToTerminal(text),
    };
    let stderr: CommandOutputStream = {
      write: (text: string) => this.config.writeToTerminal(text),
    };
    let stdin: CommandInputStream | undefined = pipeStdin;

    // Apply redirections
    for (const redir of cmd.redirections) {
      const target = await expandWord(redir.target, expandCtx);
      const targetPath = resolve(this.config.getCwd(), target);

      switch (redir.operator) {
        case '>':
          this.config.vfs.writeFile(targetPath, '');
          stdout = this.createFileWriter(targetPath);
          break;
        case '>>':
          if (!this.config.vfs.exists(targetPath)) {
            this.config.vfs.writeFile(targetPath, '');
          }
          stdout = this.createFileAppender(targetPath);
          break;
        case '<':
          stdin = this.createFileReader(targetPath);
          break;
        case '2>':
          this.config.vfs.writeFile(targetPath, '');
          stderr = this.createFileWriter(targetPath);
          break;
        case '2>>':
          if (!this.config.vfs.exists(targetPath)) {
            this.config.vfs.writeFile(targetPath, '');
          }
          stderr = this.createFileAppender(targetPath);
          break;
        case '&>':
          this.config.vfs.writeFile(targetPath, '');
          stdout = this.createFileWriter(targetPath);
          stderr = stdout;
          break;
      }
    }

    let exitCode: number;

    try {
      // Check for break/continue/return builtins
      if (name === 'break') {
        const levels = args[0] ? parseInt(args[0], 10) : 1;
        throw new BreakSignal(levels);
      }
      if (name === 'continue') {
        const levels = args[0] ? parseInt(args[0], 10) : 1;
        throw new ContinueSignal(levels);
      }
      if (name === 'return') {
        const code = args[0] ? parseInt(args[0], 10) : this.lastExitCode;
        throw new ReturnSignal(code);
      }

      // Check functions
      const funcBody = this.functions.get(name);
      if (funcBody) {
        exitCode = await this.executeFunction(funcBody, args);
      } else {
        // Check builtins
        const builtin = this.config.builtins.get(name);
        if (builtin) {
          exitCode = await builtin(args, stdout, stderr, stdin);
        } else {
          // Check registry
          const command = await this.config.registry.resolve(name);
          if (!command) {
            this.config.writeToTerminal(`${name}: command not found\n`);
            exitCode = 127;
          } else {
            const abortController = new AbortController();
            const ctx: CommandContext = {
              args,
              env: { ...this.config.env },
              cwd: this.config.getCwd(),
              vfs: this.config.vfs,
              stdout,
              stderr,
              signal: abortController.signal,
              stdin,
            };

            try {
              exitCode = await command(ctx);
            } catch (e) {
              if (e instanceof Error && e.name === 'AbortError') {
                exitCode = 130;
              } else {
                stderr.write(`${name}: ${e instanceof Error ? e.message : String(e)}\n`);
                exitCode = 1;
              }
            }
          }
        }
      }
    } finally {
      // Restore env from per-command assignments
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) {
          delete this.config.env[key];
        } else {
          this.config.env[key] = val;
        }
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  private async executeFunction(body: CompoundCommandNode, args: string[]): Promise<number> {
    // Save positional parameters
    const savedPositionals: Record<string, string | undefined> = {};
    const keysToSave = ['@', '#'];
    for (let i = 0; i <= 9; i++) keysToSave.push(String(i));
    // Save extra positional params
    for (let i = 10; i < args.length + 10; i++) keysToSave.push(String(i));

    for (const key of keysToSave) {
      savedPositionals[key] = this.config.env[key];
    }

    // Set new positional parameters
    this.config.env['#'] = String(args.length);
    this.config.env['@'] = args.join(' ');
    for (let i = 0; i < args.length; i++) {
      this.config.env[String(i + 1)] = args[i];
    }

    let exitCode: number;
    try {
      exitCode = await this.executeCommand(body);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        exitCode = e.exitCode;
      } else {
        throw e;
      }
    } finally {
      // Restore positional parameters
      for (const [key, val] of Object.entries(savedPositionals)) {
        if (val === undefined) {
          delete this.config.env[key];
        } else {
          this.config.env[key] = val;
        }
      }
    }

    this.lastExitCode = exitCode;
    return exitCode;
  }

  async executeCapture(input: string): Promise<string> {
    let captured = '';
    const stdout: CommandOutputStream = {
      write: (text: string) => { captured += text; },
    };

    const tokens = lex(input);
    const script = parse(tokens);

    // Execute with captured stdout
    for (const list of script.lists) {
      for (const entry of list.entries) {
        for (const cmd of entry.pipeline.commands) {
          await this.executeCommand(cmd, undefined, stdout);
        }
      }
    }

    return captured;
  }

  private createExpandContext(): ExpandContext {
    return {
      env: this.config.env,
      lastExitCode: this.lastExitCode,
      cwd: this.config.getCwd(),
      vfs: this.config.vfs,
      executeCapture: (input) => this.executeCapture(input),
    };
  }

  private createFileWriter(path: string): CommandOutputStream {
    return {
      write: (text: string) => {
        this.config.vfs.writeFile(path, text);
      },
    };
  }

  private createFileAppender(path: string): CommandOutputStream {
    return {
      write: (text: string) => {
        this.config.vfs.appendFile(path, text);
      },
    };
  }

  private createFileReader(path: string): CommandInputStream {
    const content = this.config.vfs.readFileString(path);
    let consumed = false;
    return {
      read: async () => {
        if (consumed) return null;
        consumed = true;
        return content;
      },
      readAll: async () => content,
    };
  }
}
