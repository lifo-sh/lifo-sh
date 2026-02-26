interface LogEntry {
  level: string;
  source: string;
  message: string;
  timestamp: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: '#8be9fd',
  warn: '#f1fa8c',
  error: '#ff5555',
};

const SOURCE_COLORS: Record<string, string> = {
  runner: '#bd93f9',
  planning: '#50fa7b',
  progress: '#ffb86c',
  testing: '#ff79c6',
  review: '#8be9fd',
  completion: '#f1fa8c',
  'status-change': '#6272a4',
};

export class LogPanel {
  private container: HTMLElement;
  private logList!: HTMLElement;
  private toggleBtn!: HTMLElement;
  private badge!: HTMLElement;
  private collapsed = true;
  private entries: LogEntry[] = [];
  private maxEntries = 200;
  private unseenCount = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  addLog(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.appendLogLine(entry);

    if (this.collapsed) {
      this.unseenCount++;
      this.badge.textContent = String(this.unseenCount);
      this.badge.style.display = 'inline-block';
    }

    // Auto-scroll
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  private render(): void {
    Object.assign(this.container.style, {
      position: 'relative',
      flexShrink: '0',
      borderTop: '1px solid #333',
      background: '#13141f',
      fontFamily: 'monospace',
      fontSize: '12px',
    });

    // Header bar (always visible)
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 12px',
      cursor: 'pointer',
      userSelect: 'none',
      color: '#888',
      background: '#1a1b26',
    });
    header.addEventListener('click', () => this.toggle());

    this.toggleBtn = document.createElement('span');
    this.toggleBtn.textContent = '▶';
    Object.assign(this.toggleBtn.style, { fontSize: '10px', transition: 'transform 0.15s' });
    header.appendChild(this.toggleBtn);

    const title = document.createElement('span');
    title.textContent = 'Pipeline Logs';
    title.style.color = '#aaa';
    header.appendChild(title);

    this.badge = document.createElement('span');
    Object.assign(this.badge.style, {
      background: '#bd93f9',
      color: '#000',
      borderRadius: '8px',
      padding: '0 6px',
      fontSize: '10px',
      fontWeight: 'bold',
      display: 'none',
    });
    header.appendChild(this.badge);

    // Clear button
    const clearBtn = document.createElement('span');
    clearBtn.textContent = 'Clear';
    Object.assign(clearBtn.style, {
      marginLeft: 'auto',
      color: '#555',
      fontSize: '11px',
      cursor: 'pointer',
    });
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.entries = [];
      this.logList.innerHTML = '';
      this.unseenCount = 0;
      this.badge.style.display = 'none';
    });
    header.appendChild(clearBtn);

    this.container.appendChild(header);

    // Log list (collapsible)
    this.logList = document.createElement('div');
    Object.assign(this.logList.style, {
      height: '0',
      overflow: 'hidden',
      transition: 'height 0.2s ease',
      background: '#0d0e17',
    });
    this.container.appendChild(this.logList);
  }

  private toggle(): void {
    this.collapsed = !this.collapsed;

    if (this.collapsed) {
      this.logList.style.height = '0';
      this.toggleBtn.style.transform = 'rotate(0deg)';
    } else {
      this.logList.style.height = '180px';
      this.logList.style.overflowY = 'auto';
      this.toggleBtn.style.transform = 'rotate(90deg)';
      this.unseenCount = 0;
      this.badge.style.display = 'none';
      // Scroll to bottom
      requestAnimationFrame(() => {
        this.logList.scrollTop = this.logList.scrollHeight;
      });
    }
  }

  private appendLogLine(entry: LogEntry): void {
    const line = document.createElement('div');
    Object.assign(line.style, {
      padding: '2px 12px',
      borderBottom: '1px solid #1a1b26',
      display: 'flex',
      gap: '8px',
      lineHeight: '1.5',
    });

    const time = document.createElement('span');
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    time.style.color = '#444';
    time.style.flexShrink = '0';

    const level = document.createElement('span');
    level.textContent = entry.level.toUpperCase().padEnd(5);
    level.style.color = LEVEL_COLORS[entry.level] || '#888';
    level.style.flexShrink = '0';

    const source = document.createElement('span');
    source.textContent = `[${entry.source}]`;
    source.style.color = SOURCE_COLORS[entry.source] || '#888';
    source.style.flexShrink = '0';

    const msg = document.createElement('span');
    msg.textContent = entry.message;
    msg.style.color = entry.level === 'error' ? '#ff5555' : '#ccc';

    line.append(time, level, source, msg);
    this.logList.appendChild(line);
  }
}
