import type { VFS } from '@lifo-sh/core';

interface KanbanActivity {
  type: string;
  message: string;
  by: string;
  timestamp: string;
}

interface TaskMetadata {
  plan?: {
    summary: string;
    steps: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
    generatedAt: string;
  };
  implementation?: {
    summary: string;
    changes: string[];
    generatedAt: string;
  };
  testResults?: {
    passed: boolean;
    summary: string;
    issues: string[];
    generatedAt: string;
  };
  review?: {
    approved: boolean;
    summary: string;
    feedback: string[];
    generatedAt: string;
  };
  completion?: {
    changelog: string;
    docsUpdated: string[];
    generatedAt: string;
  };
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  assignee_type: 'human' | 'agent' | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  activity: KanbanActivity[];
  metadata?: TaskMetadata;
  transition_count?: Record<string, number>;
}

const STATUS_ORDER = ['inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'];
const STATUS_LABELS: Record<string, string> = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  testing: 'Testing',
  review: 'Review',
  done: 'Done',
};

const COMPLEXITY_COLORS: Record<string, string> = {
  low: '#50fa7b',
  medium: '#ffb86c',
  high: '#ff5555',
};

const PRIORITY_COLORS: Record<string, string> = {
  none: '#444',
  low: '#50fa7b',
  medium: '#ffb86c',
  high: '#ff5555',
};

const ACTIVITY_ICONS: Record<string, string> = {
  created: '✦',
  status_changed: '→',
  assigned: '👤',
  note: '💬',
  updated: '✎',
  agent_started: '⚙',
  agent_output: '✓',
  agent_error: '✗',
};

const ACTIVITY_COLORS: Record<string, string> = {
  created: '#6272a4',
  status_changed: '#bd93f9',
  assigned: '#8be9fd',
  note: '#f1fa8c',
  updated: '#6272a4',
  agent_started: '#ffb86c',
  agent_output: '#50fa7b',
  agent_error: '#ff5555',
};

export class TaskPanel {
  private container: HTMLElement;
  private vfs: VFS;
  private root: string;
  private overlay!: HTMLElement;
  private panel!: HTMLElement;
  private currentTaskId: string | null = null;
  private visible = false;

  constructor(container: HTMLElement, vfs: VFS, root: string) {
    this.container = container;
    this.vfs = vfs;
    this.root = root;
    this.injectStyles();
    this.build();
  }

  showTask(taskId: string): void {
    let task: Task | null = null;
    try {
      const raw = this.vfs.readFileString(`${this.root}/tasks/${taskId}.json`);
      task = JSON.parse(raw) as Task;
    } catch {
      return;
    }
    this.currentTaskId = taskId;
    this.renderContent(task);
    this.open();
  }

  refreshIfShowing(taskId: string): void {
    if (this.visible && this.currentTaskId === taskId) {
      this.showTask(taskId);
    }
  }

  hide(): void {
    this.visible = false;
    this.overlay.style.opacity = '0';
    this.panel.style.transform = 'translateX(100%)';
    setTimeout(() => {
      this.overlay.style.display = 'none';
    }, 250);
  }

  destroy(): void {
    this.container.removeChild(this.overlay);
    this.container.removeChild(this.panel);
  }

  private open(): void {
    this.visible = true;
    this.overlay.style.display = 'block';
    requestAnimationFrame(() => {
      this.overlay.style.opacity = '1';
      this.panel.style.transform = 'translateX(0)';
    });
  }

  private build(): void {
    // Backdrop overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'tp-overlay';
    this.overlay.style.display = 'none';
    this.overlay.addEventListener('click', () => this.hide());
    this.container.appendChild(this.overlay);

    // Side panel
    this.panel = document.createElement('div');
    this.panel.className = 'tp-panel';
    this.container.appendChild(this.panel);
  }

  private renderContent(task: Task): void {
    this.panel.innerHTML = '';

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'tp-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'tp-title-row';

    const priorityDot = document.createElement('span');
    priorityDot.className = 'tp-priority-dot';
    priorityDot.style.background = PRIORITY_COLORS[task.priority] || '#444';
    priorityDot.title = task.priority;
    titleRow.appendChild(priorityDot);

    const titleEl = document.createElement('h2');
    titleEl.className = 'tp-title';
    titleEl.textContent = task.title;
    titleRow.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tp-close';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', () => this.hide());
    titleRow.appendChild(closeBtn);

    header.appendChild(titleRow);

    // Status breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'tp-breadcrumb';
    const currentIdx = STATUS_ORDER.indexOf(task.status);
    STATUS_ORDER.forEach((s, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'tp-breadcrumb-sep';
        sep.textContent = '›';
        breadcrumb.appendChild(sep);
      }
      const step = document.createElement('span');
      step.className = 'tp-breadcrumb-step' + (s === task.status ? ' active' : '') + (i < currentIdx ? ' done' : '');
      step.textContent = STATUS_LABELS[s] || s;
      breadcrumb.appendChild(step);
    });
    header.appendChild(breadcrumb);

    // Tags + assignee row
    if (task.tags.length > 0 || task.assignee) {
      const metaRow = document.createElement('div');
      metaRow.className = 'tp-meta-row';
      for (const tag of task.tags) {
        const tagEl = document.createElement('span');
        tagEl.className = 'tp-tag';
        tagEl.textContent = tag;
        metaRow.appendChild(tagEl);
      }
      if (task.assignee) {
        const assigneeEl = document.createElement('span');
        assigneeEl.className = 'tp-assignee tp-assignee-' + (task.assignee_type || 'human');
        assigneeEl.textContent = '⚙ ' + task.assignee;
        metaRow.appendChild(assigneeEl);
      }
      header.appendChild(metaRow);
    }

    this.panel.appendChild(header);

    // ── Scrollable body ──────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'tp-body';

    // Description
    if (task.description) {
      body.appendChild(this.makeSection('Description', () => {
        const p = document.createElement('p');
        p.className = 'tp-description';
        p.textContent = task.description;
        return [p];
      }));
    }

    const meta = task.metadata;

    // Plan
    if (meta?.plan) {
      body.appendChild(this.makeSection('Plan', () => {
        const els: HTMLElement[] = [];

        const summary = document.createElement('p');
        summary.className = 'tp-summary';
        summary.textContent = meta.plan!.summary;
        els.push(summary);

        const complexRow = document.createElement('div');
        complexRow.className = 'tp-badge-row';
        const complexBadge = document.createElement('span');
        complexBadge.className = 'tp-badge';
        complexBadge.style.color = COMPLEXITY_COLORS[meta.plan!.estimatedComplexity] || '#888';
        complexBadge.style.borderColor = COMPLEXITY_COLORS[meta.plan!.estimatedComplexity] || '#888';
        complexBadge.textContent = meta.plan!.estimatedComplexity + ' complexity';
        complexRow.appendChild(complexBadge);
        els.push(complexRow);

        const stepList = document.createElement('ol');
        stepList.className = 'tp-step-list';
        for (const step of meta.plan!.steps) {
          const li = document.createElement('li');
          li.textContent = step;
          stepList.appendChild(li);
        }
        els.push(stepList);

        return els;
      }, '📋'));
    }

    // Implementation
    if (meta?.implementation) {
      body.appendChild(this.makeSection('Implementation', () => {
        const els: HTMLElement[] = [];

        const summary = document.createElement('p');
        summary.className = 'tp-summary';
        summary.textContent = meta.implementation!.summary;
        els.push(summary);

        const changeList = document.createElement('ul');
        changeList.className = 'tp-change-list';
        for (const change of meta.implementation!.changes) {
          const li = document.createElement('li');
          li.textContent = change;
          changeList.appendChild(li);
        }
        els.push(changeList);

        return els;
      }, '⚙'));
    }

    // Test Results
    if (meta?.testResults) {
      const passed = meta.testResults.passed;
      body.appendChild(this.makeSection('Test Results', () => {
        const els: HTMLElement[] = [];

        const badgeRow = document.createElement('div');
        badgeRow.className = 'tp-badge-row';
        const badge = document.createElement('span');
        badge.className = 'tp-badge tp-badge-' + (passed ? 'pass' : 'fail');
        badge.textContent = passed ? '✓ PASSED' : '✗ FAILED';
        badgeRow.appendChild(badge);
        els.push(badgeRow);

        const summary = document.createElement('p');
        summary.className = 'tp-summary';
        summary.textContent = meta.testResults!.summary;
        els.push(summary);

        if (meta.testResults!.issues.length > 0) {
          const issueList = document.createElement('ul');
          issueList.className = 'tp-issue-list';
          for (const issue of meta.testResults!.issues) {
            const li = document.createElement('li');
            li.textContent = issue;
            issueList.appendChild(li);
          }
          els.push(issueList);
        }

        return els;
      }, passed ? '✓' : '✗'));
    }

    // Review
    if (meta?.review) {
      const approved = meta.review.approved;
      body.appendChild(this.makeSection('Review', () => {
        const els: HTMLElement[] = [];

        const badgeRow = document.createElement('div');
        badgeRow.className = 'tp-badge-row';
        const badge = document.createElement('span');
        badge.className = 'tp-badge tp-badge-' + (approved ? 'pass' : 'fail');
        badge.textContent = approved ? '✓ APPROVED' : '✗ REJECTED';
        badgeRow.appendChild(badge);
        els.push(badgeRow);

        const summary = document.createElement('p');
        summary.className = 'tp-summary';
        summary.textContent = meta.review!.summary;
        els.push(summary);

        if (meta.review!.feedback.length > 0) {
          const feedbackList = document.createElement('ul');
          feedbackList.className = 'tp-feedback-list';
          for (const fb of meta.review!.feedback) {
            const li = document.createElement('li');
            li.textContent = fb;
            feedbackList.appendChild(li);
          }
          els.push(feedbackList);
        }

        return els;
      }, approved ? '✓' : '✗'));
    }

    // Completion
    if (meta?.completion) {
      body.appendChild(this.makeSection('Completion', () => {
        const els: HTMLElement[] = [];

        if (meta.completion!.changelog) {
          const changelog = document.createElement('p');
          changelog.className = 'tp-summary';
          changelog.textContent = meta.completion!.changelog;
          els.push(changelog);
        }

        if (meta.completion!.docsUpdated.length > 0) {
          const docList = document.createElement('ul');
          docList.className = 'tp-change-list';
          for (const doc of meta.completion!.docsUpdated) {
            const li = document.createElement('li');
            li.textContent = doc;
            docList.appendChild(li);
          }
          els.push(docList);
        }

        return els;
      }, '🏁'));
    }

    // Activity timeline
    if (task.activity.length > 0) {
      body.appendChild(this.makeSection('Activity', () => {
        const timeline = document.createElement('div');
        timeline.className = 'tp-timeline';

        for (const entry of [...task.activity].reverse()) {
          const item = document.createElement('div');
          item.className = 'tp-timeline-item';

          const icon = document.createElement('span');
          icon.className = 'tp-timeline-icon';
          icon.textContent = ACTIVITY_ICONS[entry.type] || '·';
          icon.style.color = ACTIVITY_COLORS[entry.type] || '#888';

          const content = document.createElement('div');
          content.className = 'tp-timeline-content';

          const msgRow = document.createElement('div');
          msgRow.className = 'tp-timeline-msg';
          msgRow.textContent = entry.message;

          const metaRow = document.createElement('div');
          metaRow.className = 'tp-timeline-meta';
          metaRow.textContent = `${entry.by}  ·  ${new Date(entry.timestamp).toLocaleTimeString()}`;

          content.appendChild(msgRow);
          content.appendChild(metaRow);
          item.appendChild(icon);
          item.appendChild(content);
          timeline.appendChild(item);
        }

        return [timeline];
      }, '⏱'));
    }

    this.panel.appendChild(body);
  }

  private makeSection(title: string, content: () => HTMLElement[], icon?: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tp-section';

    const heading = document.createElement('div');
    heading.className = 'tp-section-heading';
    heading.textContent = (icon ? icon + '  ' : '') + title;
    section.appendChild(heading);

    for (const el of content()) {
      section.appendChild(el);
    }

    return section;
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .tp-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 100;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .tp-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 400px;
        height: 100vh;
        background: #1a1b26;
        border-left: 1px solid #2e2f45;
        z-index: 101;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #cdd6f4;
        box-shadow: -8px 0 32px rgba(0,0,0,0.4);
      }

      .tp-header {
        padding: 16px 18px 12px;
        border-bottom: 1px solid #2e2f45;
        flex-shrink: 0;
        background: #1e1f2e;
      }

      .tp-title-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 10px;
      }

      .tp-priority-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        margin-top: 6px;
      }

      .tp-title {
        font-size: 15px;
        font-weight: 600;
        color: #cdd6f4;
        flex: 1;
        line-height: 1.4;
        margin: 0;
      }

      .tp-close {
        background: none;
        border: none;
        color: #6272a4;
        cursor: pointer;
        font-size: 16px;
        padding: 2px 4px;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.15s;
      }
      .tp-close:hover { color: #cdd6f4; }

      .tp-breadcrumb {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }

      .tp-breadcrumb-step {
        font-size: 11px;
        color: #44475a;
        padding: 2px 6px;
        border-radius: 10px;
      }
      .tp-breadcrumb-step.done {
        color: #6272a4;
      }
      .tp-breadcrumb-step.active {
        color: #cdd6f4;
        background: #2e3155;
        font-weight: 600;
      }

      .tp-breadcrumb-sep {
        color: #44475a;
        font-size: 10px;
        margin: 0 1px;
      }

      .tp-meta-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tp-tag {
        font-size: 11px;
        background: #2e2f45;
        color: #6272a4;
        padding: 1px 7px;
        border-radius: 10px;
      }

      .tp-assignee {
        font-size: 11px;
        padding: 1px 7px;
        border-radius: 10px;
        margin-left: auto;
      }
      .tp-assignee-agent {
        background: rgba(139,233,253,0.1);
        color: #8be9fd;
      }
      .tp-assignee-human {
        background: rgba(80,250,123,0.1);
        color: #50fa7b;
      }

      .tp-body {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0 24px;
        scrollbar-width: thin;
        scrollbar-color: #2e2f45 transparent;
      }

      .tp-section {
        padding: 14px 18px;
        border-bottom: 1px solid #1e1f2e;
      }

      .tp-section-heading {
        font-size: 11px;
        font-weight: 700;
        color: #6272a4;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 10px;
      }

      .tp-description {
        color: #a6adc8;
        line-height: 1.6;
        margin: 0;
      }

      .tp-summary {
        color: #a6adc8;
        line-height: 1.5;
        margin: 0 0 10px;
      }

      .tp-badge-row {
        margin-bottom: 8px;
      }

      .tp-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid currentColor;
      }
      .tp-badge-pass {
        color: #50fa7b;
        border-color: #50fa7b;
        background: rgba(80,250,123,0.08);
      }
      .tp-badge-fail {
        color: #ff5555;
        border-color: #ff5555;
        background: rgba(255,85,85,0.08);
      }

      .tp-step-list {
        margin: 0;
        padding-left: 20px;
        color: #a6adc8;
        line-height: 1.7;
      }
      .tp-step-list li { margin-bottom: 2px; }

      .tp-change-list {
        margin: 0;
        padding-left: 16px;
        color: #a6adc8;
        line-height: 1.7;
        list-style: none;
      }
      .tp-change-list li::before { content: '·  '; color: #6272a4; }

      .tp-issue-list, .tp-feedback-list {
        margin: 8px 0 0;
        padding-left: 16px;
        color: #ffb86c;
        line-height: 1.7;
        list-style: none;
      }
      .tp-issue-list li::before, .tp-feedback-list li::before { content: '!  '; color: #ff5555; }

      .tp-timeline {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .tp-timeline-item {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }

      .tp-timeline-icon {
        font-size: 12px;
        flex-shrink: 0;
        width: 16px;
        text-align: center;
        margin-top: 1px;
      }

      .tp-timeline-content { flex: 1; }

      .tp-timeline-msg {
        color: #a6adc8;
        line-height: 1.4;
        font-size: 12px;
      }

      .tp-timeline-meta {
        color: #44475a;
        font-size: 11px;
        margin-top: 1px;
        font-family: monospace;
      }

      /* Card agent-active pulse */
      @keyframes agent-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(139,233,253,0); border-color: rgba(139,233,253,0.4); }
        50%       { box-shadow: 0 0 8px 2px rgba(139,233,253,0.25); border-color: rgba(139,233,253,0.8); }
      }
      .kb-card.agent-active {
        animation: agent-pulse 1.6s ease-in-out infinite !important;
      }
    `;
    document.head.appendChild(style);
  }
}
