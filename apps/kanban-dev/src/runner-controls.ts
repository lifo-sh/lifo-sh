type RunnerMode = 'running' | 'paused' | 'stopped' | 'step';

interface RunnerStatus {
  mode: RunnerMode;
  queueLength: number;
  stats: {
    totalForwarded: number;
    totalDropped: number;
    totalQueued: number;
    lastEventAt: string | null;
  };
}

const MODE_COLORS: Record<RunnerMode, string> = {
  stopped: '#f44',
  running: '#4f4',
  paused: '#fa0',
  step: '#48f',
};

const MODE_LABELS: Record<RunnerMode, string> = {
  stopped: 'STOPPED',
  running: 'RUNNING',
  paused: 'PAUSED',
  step: 'STEP',
};

export class RunnerControls {
  private container: HTMLElement;
  private dot!: HTMLElement;
  private label!: HTMLElement;
  private queueLabel!: HTMLElement;
  private statsLabel!: HTMLElement;
  private btnStart!: HTMLButtonElement;
  private btnPause!: HTMLButtonElement;
  private btnStop!: HTMLButtonElement;
  private btnStep!: HTMLButtonElement;
  private status: RunnerStatus = {
    mode: 'stopped',
    queueLength: 0,
    stats: { totalForwarded: 0, totalDropped: 0, totalQueued: 0, lastEventAt: null },
  };
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), 2000);
  }

  /** Called externally when a runner-status WS message arrives */
  updateStatus(status: RunnerStatus): void {
    this.status = status;
    this.refresh();
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private render(): void {
    this.container.innerHTML = '';
    Object.assign(this.container.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 16px',
      background: '#1e1f2e',
      borderBottom: '1px solid #333',
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ccc',
      flexShrink: '0',
    });

    // Status dot
    this.dot = document.createElement('span');
    Object.assign(this.dot.style, {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      display: 'inline-block',
      flexShrink: '0',
    });
    this.container.appendChild(this.dot);

    // Mode label
    this.label = document.createElement('span');
    Object.assign(this.label.style, { fontWeight: 'bold', minWidth: '70px' });
    this.container.appendChild(this.label);

    // Buttons
    const btnGroup = document.createElement('span');
    Object.assign(btnGroup.style, { display: 'flex', gap: '6px' });

    this.btnStart = this.makeBtn('▶ Start', () => this.action('start'));
    this.btnPause = this.makeBtn('⏸ Pause', () => this.action('pause'));
    this.btnStop  = this.makeBtn('■ Stop', () => this.action('stop'));
    this.btnStep  = this.makeBtn('⏭ Step', () => this.action('step'));

    btnGroup.append(this.btnStart, this.btnPause, this.btnStop, this.btnStep);
    this.container.appendChild(btnGroup);

    // Queue count
    this.queueLabel = document.createElement('span');
    Object.assign(this.queueLabel.style, { marginLeft: '12px', color: '#888' });
    this.container.appendChild(this.queueLabel);

    // Stats
    this.statsLabel = document.createElement('span');
    Object.assign(this.statsLabel.style, { marginLeft: 'auto', color: '#666', fontSize: '11px' });
    this.container.appendChild(this.statsLabel);

    this.refresh();
  }

  private makeBtn(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      background: '#2a2b3d',
      color: '#ccc',
      border: '1px solid #444',
      borderRadius: '4px',
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: 'monospace',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#3a3b5d'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#2a2b3d'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  private refresh(): void {
    const { mode, queueLength, stats } = this.status;

    // Dot color
    this.dot.style.background = MODE_COLORS[mode];

    // Label
    this.label.textContent = MODE_LABELS[mode];
    this.label.style.color = MODE_COLORS[mode];

    // Queue
    this.queueLabel.textContent = `Queue: ${queueLength}`;

    // Stats
    this.statsLabel.textContent = `Forwarded: ${stats.totalForwarded} | Queued: ${stats.totalQueued} | Dropped: ${stats.totalDropped}`;

    // Button enable/disable
    this.btnStart.disabled = mode === 'running';
    this.btnPause.disabled = mode === 'paused' || mode === 'stopped';
    this.btnStop.disabled  = mode === 'stopped';
    this.btnStep.disabled  = mode === 'running' || mode === 'stopped';

    for (const btn of [this.btnStart, this.btnPause, this.btnStop, this.btnStep]) {
      btn.style.opacity = btn.disabled ? '0.4' : '1';
      btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
    }
  }

  private async action(cmd: 'start' | 'pause' | 'stop' | 'step'): Promise<void> {
    try {
      const res = await fetch(`/api/runner/${cmd}`, { method: 'POST' });
      const status = await res.json();
      this.status = status;
      this.refresh();
    } catch (err) {
      console.error(`[runner-controls] ${cmd} failed:`, err);
    }
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch('/api/runner/status');
      const status = await res.json();
      this.status = status;
      this.refresh();
    } catch { /* server down */ }
  }
}
