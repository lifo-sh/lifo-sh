import type { Command } from '../types.js';

const BUILTINS = new Set([
  'cd', 'pwd', 'echo', 'clear', 'export', 'exit',
  'true', 'false', 'jobs', 'fg', 'bg', 'history',
  'source', '.', 'alias', 'unalias',
]);

const REGISTERED = new Set([
  'ls', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'touch',
  'grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk',
  'find', 'tree', 'stat', 'ln', 'du', 'df', 'chmod', 'file',
  'tee', 'xargs', 'yes', 'printf',
  'env', 'uname', 'date', 'sleep', 'uptime', 'whoami', 'hostname', 'free', 'which',
  // Network
  'curl', 'wget', 'ping', 'dig',
  // Archive
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  // Node.js & package manager
  'node', 'pkg',
  // Sprint 6a: Filesystem
  'rmdir', 'realpath', 'basename', 'dirname', 'mktemp', 'chown',
  // Sprint 6a: Text
  'diff', 'nl', 'rev',
  // Sprint 6a: System
  'ps', 'top', 'kill', 'watch', 'cal', 'bc', 'man', 'help',
]);

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    ctx.stderr.write('which: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const name of ctx.args) {
    if (BUILTINS.has(name)) {
      ctx.stdout.write(`${name}: shell built-in command\n`);
    } else if (REGISTERED.has(name)) {
      ctx.stdout.write(`${name}\n`);
    } else {
      ctx.stderr.write(`which: ${name}: not found\n`);
      exitCode = 1;
    }
  }

  return exitCode;
};

export default command;
