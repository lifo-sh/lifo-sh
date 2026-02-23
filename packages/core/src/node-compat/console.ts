import type { CommandOutputStream } from '../commands/types.js';
import { format } from './util.js';

export function createConsole(stdout: CommandOutputStream, stderr: CommandOutputStream) {
  const timers = new Map<string, number>();

  return {
    log: (...args: unknown[]) => {
      stdout.write(format(args[0] as string, ...args.slice(1)) + '\n');
    },
    info: (...args: unknown[]) => {
      stdout.write(format(args[0] as string, ...args.slice(1)) + '\n');
    },
    warn: (...args: unknown[]) => {
      stderr.write(format(args[0] as string, ...args.slice(1)) + '\n');
    },
    error: (...args: unknown[]) => {
      stderr.write(format(args[0] as string, ...args.slice(1)) + '\n');
    },
    debug: (...args: unknown[]) => {
      stdout.write(format(args[0] as string, ...args.slice(1)) + '\n');
    },
    dir: (obj: unknown) => {
      stdout.write(format('%o', obj) + '\n');
    },
    time: (label = 'default') => {
      timers.set(label, performance.now());
    },
    timeEnd: (label = 'default') => {
      const start = timers.get(label);
      if (start !== undefined) {
        const elapsed = performance.now() - start;
        stdout.write(`${label}: ${elapsed.toFixed(3)}ms\n`);
        timers.delete(label);
      } else {
        stderr.write(`Warning: No such label '${label}' for console.timeEnd()\n`);
      }
    },
    timeLog: (label = 'default', ...args: unknown[]) => {
      const start = timers.get(label);
      if (start !== undefined) {
        const elapsed = performance.now() - start;
        stdout.write(`${label}: ${elapsed.toFixed(3)}ms ${args.map((a) => format('%o', a)).join(' ')}\n`);
      }
    },
    trace: (...args: unknown[]) => {
      stderr.write('Trace: ' + format(args[0] as string, ...args.slice(1)) + '\n');
    },
    assert: (condition: unknown, ...args: unknown[]) => {
      if (!condition) {
        stderr.write('Assertion failed: ' + (args.length > 0 ? format(args[0] as string, ...args.slice(1)) : '') + '\n');
      }
    },
    clear: () => { /* no-op */ },
    count: (() => {
      const counts = new Map<string, number>();
      return (label = 'default') => {
        const count = (counts.get(label) ?? 0) + 1;
        counts.set(label, count);
        stdout.write(`${label}: ${count}\n`);
      };
    })(),
    countReset: () => { /* no-op */ },
    group: () => { /* no-op */ },
    groupEnd: () => { /* no-op */ },
    table: (data: unknown) => {
      stdout.write(format('%o', data) + '\n');
    },
  };
}
