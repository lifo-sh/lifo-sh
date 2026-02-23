export interface Job {
  id: number;
  command: string;
  promise: Promise<number>;
  abortController: AbortController;
  status: 'running' | 'done' | 'stopped';
  exitCode: number | null;
}

export class JobTable {
  private jobs = new Map<number, Job>();
  private nextId = 1;

  add(command: string, promise: Promise<number>, abortController: AbortController): number {
    const id = this.nextId++;
    const job: Job = {
      id,
      command,
      promise,
      abortController,
      status: 'running',
      exitCode: null,
    };

    promise.then((code) => {
      job.status = 'done';
      job.exitCode = code;
    }).catch(() => {
      job.status = 'done';
      job.exitCode = 1;
    });

    this.jobs.set(id, job);
    return id;
  }

  list(): Job[] {
    return Array.from(this.jobs.values());
  }

  get(id: number): Job | undefined {
    return this.jobs.get(id);
  }

  remove(id: number): void {
    this.jobs.delete(id);
  }

  /**
   * Collect and remove finished jobs, returning their info for display.
   */
  collectDone(): Job[] {
    const done: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'done') {
        done.push(job);
      }
    }
    for (const job of done) {
      this.jobs.delete(job.id);
    }
    return done;
  }
}
