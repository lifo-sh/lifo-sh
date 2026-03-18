import type { Command } from '../types.js';
import type { Process } from '../../shell/ProcessRegistry.js';
import type { Kernel } from '@lifo-sh/kernel';

/**
 * Map process status to Linux-style STAT codes.
 *   R = running, S = sleeping, T = stopped, Z = zombie
 *   + = foreground process group
 */
function statCode(proc: Process): string {
  const base =
    proc.status === 'running' ? 'R' :
    proc.status === 'sleeping' ? 'S' :
    proc.status === 'stopped' ? 'T' :
    proc.status === 'zombie' ? 'Z' : '?';
  return proc.isForeground ? base + '+' : base;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatStartTime(startTime: number): string {
  const d = new Date(startTime);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Default ps (no flags) — shows processes for current session, like Linux `ps`.
 * Columns: PID PPID TTY STAT TIME CMD
 */
function printDefault(processes: Process[], write: (s: string) => void): void {
  write('  PID  PPID TTY      STAT   TIME CMD\n');
  for (const proc of processes) {
    const pid = proc.pid.toString().padStart(5);
    const ppid = proc.ppid.toString().padStart(5);
    const stat = statCode(proc).padEnd(4);
    const time = formatTime(Date.now() - proc.startTime);
    const cmd = proc.status === 'zombie'
      ? `[${proc.command}] <defunct>`
      : proc.args.join(' ');
    write(`${pid} ${ppid} pts/0    ${stat} ${time} ${cmd}\n`);
  }
}

/**
 * ps -f / ps -ef — full format listing.
 * Columns: UID PID PPID STAT STIME TIME CMD
 */
function printFull(processes: Process[], write: (s: string) => void): void {
  write('UID        PID  PPID STAT STIME   TIME CMD\n');
  for (const proc of processes) {
    const uid = (proc.env['USER'] ?? 'user').padEnd(8);
    const pid = proc.pid.toString().padStart(5);
    const ppid = proc.ppid.toString().padStart(5);
    const stat = statCode(proc).padEnd(4);
    const stime = formatStartTime(proc.startTime);
    const time = formatTime(Date.now() - proc.startTime);
    const cmd = proc.status === 'zombie'
      ? `[${proc.command}] <defunct>`
      : proc.args.join(' ');
    write(`${uid} ${pid} ${ppid} ${stat} ${stime} ${time} ${cmd}\n`);
  }
}

export function createPsCommand(kernel: Kernel): Command {
  return async (ctx) => {
    const args = ctx.args.slice(1); // skip 'ps' itself
    const flagStr = args.join(' ');

    // Parse flags (support both BSD-style and POSIX-style)
    const showAll = /\b-e\b/.test(flagStr) || /\b-A\b/.test(flagStr) || /\baux\b/.test(flagStr) || /\b-ax\b/.test(flagStr);
    const fullFormat = /\b-f\b/.test(flagStr) || /\baux\b/.test(flagStr) || /\b-l\b/.test(flagStr);

    let processes = kernel.processRegistry.getAll();

    // Sort by PID
    processes.sort((a, b) => a.pid - b.pid);

    // Without -e/-A, only show processes for the current session (all of them in our case,
    // since we have a single session — but filter out zombies for cleaner default output)
    if (!showAll) {
      processes = processes.filter((p) => p.status !== 'zombie');
    }

    if (fullFormat) {
      printFull(processes, (s) => ctx.stdout.write(s));
    } else {
      printDefault(processes, (s) => ctx.stdout.write(s));
    }

    return 0;
  };
}

// Legacy function for backward compatibility
export function createPsCommandFromJobTable(jobTable: any): Command {
  return async (ctx) => {
    ctx.stdout.write('  PID TTY      STAT   TIME CMD\n');

    // Shell is always PID 1
    ctx.stdout.write('    1 pts/0    S+   00:00:00 sh\n');

    // Background jobs
    const jobs = jobTable.list();
    for (const job of jobs) {
      const pid = String(job.id + 1).padStart(5, ' ');
      const status = job.status === 'running' ? 'R ' : 'Z ';
      const cmdName = job.command.split(/\s+/)[0];
      ctx.stdout.write(`${pid} pts/0    ${status}   00:00:00 ${cmdName}\n`);
    }

    // ps itself is the last entry
    const psPid = String(jobs.length + 2).padStart(5, ' ');
    ctx.stdout.write(`${psPid} pts/0    R+   00:00:00 ps\n`);

    return 0;
  };
}
