// Sandbox (high-level API)
export { Sandbox } from './sandbox/index.js';
export type {
  SandboxOptions,
  RunOptions,
  CommandResult,
  SandboxCommands,
  SandboxFs,
} from './sandbox/index.js';

// Kernel
export { Kernel } from './kernel/index.js';
export type { VirtualRequest, VirtualResponse, VirtualRequestHandler } from './kernel/index.js';

// VFS
export { VFS, VFSError, ErrorCode } from './kernel/vfs/index.js';
export type {
  INode,
  Stat,
  Dirent,
  FileType,
  ErrorCodeType,
  VirtualProvider,
} from './kernel/vfs/index.js';

// Commands
export { CommandRegistry, createDefaultRegistry } from './commands/registry.js';
export type {
  Command,
  CommandContext,
  CommandOutputStream,
  CommandInputStream,
} from './commands/types.js';

// Factory commands
export { createPkgCommand } from './commands/system/pkg.js';
export { createPsCommand } from './commands/system/ps.js';
export { createTopCommand } from './commands/system/top.js';
export { createKillCommand } from './commands/system/kill.js';
export { createWatchCommand } from './commands/system/watch.js';
export { createHelpCommand } from './commands/system/help.js';
export { createNodeCommand } from './commands/system/node.js';
export { createCurlCommand } from './commands/net/curl.js';

// Shell
export { Shell } from './shell/Shell.js';
export { JobTable } from './shell/jobs.js';

// Terminal
export type { ITerminal } from './terminal/ITerminal.js';
export { HeadlessTerminal } from './sandbox/HeadlessTerminal.js';

// Package manager
export { PackageManager } from './pkg/PackageManager.js';
export { loadInstalledPackages } from './pkg/loader.js';

// Node compatibility
export { createModuleMap, ProcessExitError } from './node-compat/index.js';
export type { NodeContext } from './node-compat/index.js';

// Color utilities
export {
  RESET,
  BOLD,
  DIM,
  ITALIC,
  UNDERLINE,
  RED,
  GREEN,
  YELLOW,
  BLUE,
  MAGENTA,
  CYAN,
  WHITE,
  BRIGHT_RED,
  BRIGHT_GREEN,
  BRIGHT_YELLOW,
  BRIGHT_BLUE,
  BRIGHT_MAGENTA,
  BRIGHT_CYAN,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  bold,
  dim,
} from './utils/colors.js';
