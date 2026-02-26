import * as fs from 'node:fs';

export interface QueueEntry {
  taskId: string;
  taskPath: string;
  fromStatus: string;
  toStatus: string;
  agentName: string;
  queuedAt: string;
}

export interface RunnerStatus {
  mode: 'running' | 'paused' | 'stopped' | 'step';
  queueLength: number;
  queue: QueueEntry[];
  stats: {
    totalForwarded: number;
    totalDropped: number;
    totalQueued: number;
    lastEventAt: string | null;
  };
  startedAt: string | null;
  pausedAt: string | null;
}

export class Runner {
  mode: 'running' | 'paused' | 'stopped' | 'step' = 'stopped';
  queue: QueueEntry[] = [];
  stats = {
    totalForwarded: 0,
    totalDropped: 0,
    totalQueued: 0,
    lastEventAt: null as string | null,
  };
  startedAt: string | null = null;
  pausedAt: string | null = null;

  private configPath: string;
  private dispatchFn: ((entry: QueueEntry) => Promise<void>) | null = null;
  private draining = false;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.load();
  }

  setDispatcher(fn: (entry: QueueEntry) => Promise<void>): void {
    this.dispatchFn = fn;
  }

  start(): RunnerStatus {
    this.mode = 'running';
    this.startedAt = new Date().toISOString();
    this.pausedAt = null;
    this.persist();
    console.log('[runner] mode → running');
    // Drain any queued entries
    this.drainQueue();
    return this.getStatus();
  }

  pause(): RunnerStatus {
    this.mode = 'paused';
    this.pausedAt = new Date().toISOString();
    this.persist();
    console.log('[runner] mode → paused');
    return this.getStatus();
  }

  stop(): RunnerStatus {
    this.mode = 'stopped';
    const dropped = this.queue.length;
    this.queue = [];
    this.stats.totalDropped += dropped;
    this.startedAt = null;
    this.pausedAt = null;
    this.persist();
    console.log(`[runner] mode → stopped (dropped ${dropped} queued)`);
    return this.getStatus();
  }

  step(): RunnerStatus {
    if (this.mode !== 'paused' && this.mode !== 'step') {
      console.log(`[runner] step ignored — mode is ${this.mode}`);
      return this.getStatus();
    }
    this.mode = 'step';
    this.persist();
    console.log('[runner] stepping one entry');
    this.forwardOne();
    return this.getStatus();
  }

  requestDispatch(entry: QueueEntry): void {
    this.stats.lastEventAt = new Date().toISOString();

    switch (this.mode) {
      case 'running':
        console.log(`[runner] dispatching ${entry.agentName} for task ${entry.taskId}`);
        this.stats.totalForwarded++;
        this.persist();
        this.dispatch(entry);
        break;
      case 'paused':
      case 'step':
        console.log(`[runner] queuing ${entry.agentName} for task ${entry.taskId} (mode=${this.mode})`);
        this.queue.push(entry);
        this.stats.totalQueued++;
        this.persist();
        break;
      case 'stopped':
        console.log(`[runner] dropping ${entry.agentName} for task ${entry.taskId} (stopped)`);
        this.stats.totalDropped++;
        this.persist();
        break;
    }
  }

  getStatus(): RunnerStatus {
    return {
      mode: this.mode,
      queueLength: this.queue.length,
      queue: [...this.queue],
      stats: { ...this.stats },
      startedAt: this.startedAt,
      pausedAt: this.pausedAt,
    };
  }

  clearQueue(): void {
    const dropped = this.queue.length;
    this.queue = [];
    this.stats.totalDropped += dropped;
    this.persist();
    console.log(`[runner] queue cleared (${dropped} entries dropped)`);
  }

  private async dispatch(entry: QueueEntry): Promise<void> {
    if (!this.dispatchFn) {
      console.error('[runner] no dispatcher set!');
      return;
    }
    try {
      await this.dispatchFn(entry);
    } catch (err) {
      console.error(`[runner] agent ${entry.agentName} failed:`, err);
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && this.mode === 'running') {
        const entry = this.queue.shift()!;
        this.stats.totalForwarded++;
        this.persist();
        await this.dispatch(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  private async forwardOne(): Promise<void> {
    if (this.queue.length === 0) {
      console.log('[runner] step: queue empty, nothing to forward');
      return;
    }
    const entry = this.queue.shift()!;
    this.stats.totalForwarded++;
    this.persist();
    await this.dispatch(entry);
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        mode: this.mode,
        queue: this.queue,
        stats: this.stats,
        startedAt: this.startedAt,
        pausedAt: this.pausedAt,
      }, null, 2));
    } catch (err) {
      console.error('[runner] failed to persist state:', err);
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.mode = data.mode || 'stopped';
        this.queue = data.queue || [];
        this.stats = { ...this.stats, ...data.stats };
        this.startedAt = data.startedAt || null;
        this.pausedAt = data.pausedAt || null;
        console.log(`[runner] loaded state: mode=${this.mode}, queue=${this.queue.length}`);
      }
    } catch {
      console.log('[runner] no persisted state, starting fresh');
    }
  }
}
