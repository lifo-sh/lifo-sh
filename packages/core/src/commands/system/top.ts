import type { Command } from '../types.js';
import type { JobTable } from '../../shell/jobs.js';

export function createTopCommand(jobTable: JobTable): Command {
  return async (ctx) => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');

    // Uptime from performance.now()
    const uptimeMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const uptimeMin = Math.floor(uptimeMs / 60000);

    // CPU info
    const cpuCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;

    // Memory info
    const perfMemory = typeof performance !== 'undefined' ? (performance as any).memory : undefined;
    const totalMem = perfMemory ? Math.round(perfMemory.jsHeapSizeLimit / (1024 * 1024)) : 256;
    const usedMem = perfMemory ? Math.round(perfMemory.usedJSHeapSize / (1024 * 1024)) : 16;
    const freeMem = totalMem - usedMem;

    // Process list
    const jobs = jobTable.list();
    const runningCount = jobs.filter(j => j.status === 'running').length;
    const stoppedCount = jobs.filter(j => j.status === 'stopped').length;
    const totalTasks = jobs.length + 2; // + shell + top itself

    ctx.stdout.write(`top - ${hours}:${mins}:${secs} up ${uptimeMin} min,  1 user\n`);
    ctx.stdout.write(`Tasks: ${String(totalTasks).padStart(3, ' ')} total, ${String(runningCount + 2).padStart(3, ' ')} running, ${String(stoppedCount).padStart(3, ' ')} stopped\n`);
    ctx.stdout.write(`%Cpu(s): ${cpuCores} cores\n`);
    ctx.stdout.write(`MiB Mem: ${String(totalMem).padStart(7, ' ')} total ${String(usedMem).padStart(7, ' ')} used ${String(freeMem).padStart(7, ' ')} free\n`);
    ctx.stdout.write('\n');
    ctx.stdout.write('  PID CMD            STATUS\n');

    // Shell
    ctx.stdout.write('    1 sh             running\n');

    // Background jobs
    for (const job of jobs) {
      const pid = String(job.id + 1).padStart(5, ' ');
      const cmdName = job.command.split(/\s+/)[0].padEnd(15, ' ');
      ctx.stdout.write(`${pid} ${cmdName}${job.status}\n`);
    }

    // top itself
    const topPid = String(jobs.length + 2).padStart(5, ' ');
    ctx.stdout.write(`${topPid} top            running\n`);

    return 0;
  };
}
