import type { VFS } from '@lifo-sh/core';

// ─── Types ───

export type KanbanStatus = 'inbox' | 'assigned' | 'in_progress' | 'testing' | 'review' | 'done';
export type KanbanPriority = 'none' | 'low' | 'medium' | 'high';

export interface KanbanDeliverable {
  type: 'file' | 'url' | 'artifact';
  title: string;
  path: string;
  description?: string;
  created_at: string;
}

export interface KanbanActivity {
  type: 'created' | 'status_changed' | 'assigned' | 'note' | 'updated';
  message: string;
  by: string;
  timestamp: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assignee: string | null;
  assignee_type: 'human' | 'agent' | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deliverables: KanbanDeliverable[];
  activity: KanbanActivity[];
}

export interface KanbanAssignee {
  id: string;
  name: string;
  type: 'human' | 'agent';
  avatar?: string;
}

export interface KanbanBoardOptions {
  root?: string;
  assignees?: KanbanAssignee[];
}

export type KanbanBoardEvent =
  | { type: 'card-moved'; taskId: string; from: KanbanStatus; to: KanbanStatus }
  | { type: 'card-created'; taskId: string }
  | { type: 'card-updated'; taskId: string }
  | { type: 'card-deleted'; taskId: string }
  | { type: 'card-assigned'; taskId: string; assignee: string | null };

type EventHandler = (event: KanbanBoardEvent) => void;

// ─── Column config ───

const COLUMNS: { id: KanbanStatus; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'testing', label: 'Testing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const PRIORITY_COLORS: Record<KanbanPriority, string> = {
  none: '#565f89',
  low: '#9ece6a',
  medium: '#ff9e64',
  high: '#f7768e',
};

// ─── Styles ───

const STYLES = `
.kb-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #1a1b26;
  color: #a9b1d6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  overflow: hidden;
  position: relative;
}

.kb-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #2f3146;
  background: #16161e;
  flex-shrink: 0;
}

.kb-title {
  font-size: 13px;
  font-weight: 600;
  color: #c0caf5;
}

.kb-board {
  display: flex;
  gap: 12px;
  padding: 12px;
  overflow-x: auto;
  flex: 1;
  min-height: 0;
  align-items: flex-start;
}

.kb-column {
  display: flex;
  flex-direction: column;
  min-width: 220px;
  width: 220px;
  background: #16161e;
  border: 1px solid #2f3146;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  max-height: 100%;
}

.kb-col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid #2f3146;
  flex-shrink: 0;
}

.kb-col-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #737aa2;
}

.kb-col-count {
  font-size: 11px;
  color: #565f89;
  background: #1a1b26;
  border-radius: 10px;
  padding: 1px 6px;
}

.kb-col-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 60px;
}

.kb-col-body.drag-over {
  background: #1e2030;
  outline: 2px dashed #3d59a1;
  outline-offset: -2px;
  border-radius: 4px;
}

.kb-card {
  background: #1a1b26;
  border: 1px solid #2f3146;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}

.kb-card:hover {
  border-color: #414868;
  background: #1e2030;
}

.kb-card.dragging {
  opacity: 0.5;
}

.kb-card-header {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.kb-priority-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 3px;
}

.kb-card-title {
  font-size: 12px;
  color: #c0caf5;
  line-height: 1.4;
  flex: 1;
}

.kb-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.kb-card-tags {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}

.kb-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #1e2030;
  color: #565f89;
  border: 1px solid #2f3146;
}

.kb-assignee-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.kb-assignee-badge.human {
  background: #1a3a5c;
  color: #7aa2f7;
}

.kb-assignee-badge.agent {
  background: #2d1a5c;
  color: #bb9af7;
}

.kb-col-footer {
  padding: 6px;
  flex-shrink: 0;
}

.kb-add-btn {
  width: 100%;
  padding: 5px 8px;
  background: transparent;
  border: 1px dashed #2f3146;
  border-radius: 5px;
  color: #565f89;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.kb-add-btn:hover {
  background: #1e2030;
  color: #a9b1d6;
  border-color: #414868;
}

.kb-add-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  background: #1a1b26;
  border: 1px solid #7aa2f7;
  border-radius: 5px;
  color: #c0caf5;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

/* ── Detail Panel ── */

.kb-detail-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 10;
  display: none;
}

.kb-detail-overlay.open {
  display: block;
}

.kb-detail-panel {
  position: absolute;
  top: 0;
  right: -400px;
  width: 340px;
  height: 100%;
  background: #16161e;
  border-left: 1px solid #2f3146;
  z-index: 11;
  display: flex;
  flex-direction: column;
  transition: right 0.2s ease;
  overflow: hidden;
}

.kb-detail-panel.open {
  right: 0;
}

.kb-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #2f3146;
  flex-shrink: 0;
}

.kb-detail-close {
  background: none;
  border: none;
  color: #565f89;
  cursor: pointer;
  font-size: 18px;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}

.kb-detail-close:hover {
  color: #a9b1d6;
}

.kb-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kb-field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #565f89;
  font-weight: 600;
  margin-bottom: 3px;
}

.kb-field-input {
  width: 100%;
  box-sizing: border-box;
  background: #1a1b26;
  border: 1px solid #2f3146;
  border-radius: 5px;
  color: #c0caf5;
  font-size: 12px;
  font-family: inherit;
  padding: 6px 8px;
  outline: none;
  transition: border-color 0.15s;
}

.kb-field-input:focus {
  border-color: #7aa2f7;
}

textarea.kb-field-input {
  resize: vertical;
  min-height: 80px;
}

.kb-field-select {
  width: 100%;
  box-sizing: border-box;
  background: #1a1b26;
  border: 1px solid #2f3146;
  border-radius: 5px;
  color: #a9b1d6;
  font-size: 12px;
  font-family: inherit;
  padding: 6px 8px;
  outline: none;
  cursor: pointer;
  appearance: none;
  transition: border-color 0.15s;
}

.kb-field-select:focus {
  border-color: #7aa2f7;
}

.kb-save-btn {
  padding: 6px 14px;
  background: #3d59a1;
  border: none;
  border-radius: 5px;
  color: #c0caf5;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.kb-save-btn:hover {
  background: #7aa2f7;
  color: #1a1b26;
}

.kb-delete-btn {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid #f7768e;
  border-radius: 5px;
  color: #f7768e;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.kb-delete-btn:hover {
  background: #f7768e;
  color: #1a1b26;
}

.kb-activity-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kb-activity-entry {
  font-size: 11px;
  color: #565f89;
  padding: 4px 0;
  border-bottom: 1px solid #1e2030;
  line-height: 1.5;
}

.kb-activity-entry .kb-act-message {
  color: #737aa2;
}

.kb-activity-entry .kb-act-meta {
  font-size: 10px;
  color: #3b4261;
  margin-top: 1px;
}

.kb-detail-actions {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #2f3146;
  flex-shrink: 0;
}
`;

// ─── KanbanStore ───

class KanbanStore {
  private root: string;
  private vfs: VFS;

  constructor(vfs: VFS, root: string) {
    this.vfs = vfs;
    this.root = root;
  }

  init(): void {
    try { this.vfs.mkdir(this.root, { recursive: true }); } catch { /* already exists */ }
    try { this.vfs.mkdir(this.root + '/tasks', { recursive: true }); } catch { /* already exists */ }

    const boardPath = this.root + '/board.json';
    try {
      this.vfs.readFileString(boardPath);
    } catch {
      const board = {
        id: crypto.randomUUID(),
        name: 'My Board',
        columns: ['inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'],
        created_at: new Date().toISOString(),
      };
      this.vfs.writeFile(boardPath, JSON.stringify(board, null, 2));
    }
  }

  loadAllTasks(): KanbanTask[] {
    try {
      const entries = this.vfs.readdir(this.root + '/tasks');
      const tasks: KanbanTask[] = [];
      for (const entry of entries) {
        if (entry.type === 'file' && entry.name.endsWith('.json')) {
          try {
            const content = this.vfs.readFileString(this.root + '/tasks/' + entry.name);
            tasks.push(JSON.parse(content) as KanbanTask);
          } catch { /* skip malformed files */ }
        }
      }
      return tasks;
    } catch {
      return [];
    }
  }

  loadTask(id: string): KanbanTask | null {
    try {
      const content = this.vfs.readFileString(this.root + '/tasks/' + id + '.json');
      return JSON.parse(content) as KanbanTask;
    } catch {
      return null;
    }
  }

  saveTask(task: KanbanTask): void {
    task.updated_at = new Date().toISOString();
    this.vfs.writeFile(this.root + '/tasks/' + task.id + '.json', JSON.stringify(task, null, 2));
  }

  createTask(fields: { title: string; status: KanbanStatus } & Partial<KanbanTask>): KanbanTask {
    const now = new Date().toISOString();
    const task: KanbanTask = {
      id: crypto.randomUUID(),
      title: fields.title,
      description: fields.description ?? '',
      status: fields.status,
      priority: fields.priority ?? 'none',
      assignee: fields.assignee ?? null,
      assignee_type: fields.assignee_type ?? null,
      tags: fields.tags ?? [],
      created_at: now,
      updated_at: now,
      deliverables: [],
      activity: [{
        type: 'created',
        message: 'Task created',
        by: 'user',
        timestamp: now,
      }],
    };
    this.vfs.writeFile(this.root + '/tasks/' + task.id + '.json', JSON.stringify(task, null, 2));
    return task;
  }

  moveTask(id: string, newStatus: KanbanStatus): void {
    const task = this.loadTask(id);
    if (!task) return;
    const oldStatus = task.status;
    task.status = newStatus;
    task.activity.push({
      type: 'status_changed',
      message: `Moved from ${oldStatus} to ${newStatus}`,
      by: 'user',
      timestamp: new Date().toISOString(),
    });
    this.saveTask(task);
  }

  deleteTask(id: string): void {
    try {
      this.vfs.unlink(this.root + '/tasks/' + id + '.json');
    } catch { /* ignore */ }
  }
}

// ─── KanbanBoard ───

export class KanbanBoard {
  private container: HTMLElement;
  private vfs: VFS;
  private options: { root: string; assignees: KanbanAssignee[] };
  private store: KanbanStore;
  private root: HTMLElement;
  private detailPanel: HTMLElement | null = null;
  private detailOverlay: HTMLElement | null = null;
  private selectedTaskId: string | null = null;
  private handlers: EventHandler[] = [];
  private unwatch: (() => void) | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private _rendering = false;

  constructor(container: HTMLElement, vfs: VFS, options?: KanbanBoardOptions) {
    this.container = container;
    this.vfs = vfs;
    this.options = {
      root: options?.root ?? '/home/user/.kanban',
      assignees: options?.assignees ?? [],
    };
    this.store = new KanbanStore(vfs, this.options.root);

    // Inject scoped styles
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    document.head.appendChild(this.styleEl);

    // Root container
    this.root = document.createElement('div');
    this.root.className = 'kb-root';
    this.container.appendChild(this.root);

    // Init VFS dirs and board config
    this.store.init();

    // Initial render
    this.render();

    // Watch for VFS changes (bot writes, etc.)
    this.unwatch = this.vfs.watch(this.options.root, () => {
      if (!this._rendering) {
        this.render();
      }
    });
  }

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.unwatch?.();
    this.styleEl?.remove();
    this.root.remove();
  }

  private emit(event: KanbanBoardEvent): void {
    for (const h of this.handlers) h(event);
  }

  private render(): void {
    this._rendering = true;

    const tasks = this.store.loadAllTasks();

    // Group tasks by status
    const tasksByStatus = new Map<KanbanStatus, KanbanTask[]>();
    for (const col of COLUMNS) tasksByStatus.set(col.id, []);
    for (const task of tasks) {
      const col = tasksByStatus.get(task.status);
      if (col) col.push(task);
    }

    // Re-build DOM
    this.root.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'kb-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'kb-title';
    titleEl.textContent = 'Kanban Board';
    header.appendChild(titleEl);
    this.root.appendChild(header);

    // Board
    const boardEl = document.createElement('div');
    boardEl.className = 'kb-board';
    for (const col of COLUMNS) {
      const colTasks = tasksByStatus.get(col.id) ?? [];
      boardEl.appendChild(this.renderColumn(col, colTasks));
    }
    this.root.appendChild(boardEl);

    // Detail overlay
    this.detailOverlay = document.createElement('div');
    this.detailOverlay.className = 'kb-detail-overlay';
    this.detailOverlay.addEventListener('click', () => this.closeDetail());
    this.root.appendChild(this.detailOverlay);

    // Detail panel
    this.detailPanel = document.createElement('div');
    this.detailPanel.className = 'kb-detail-panel';
    this.root.appendChild(this.detailPanel);

    // Re-open detail if a task was selected before re-render
    if (this.selectedTaskId) {
      const task = this.store.loadTask(this.selectedTaskId);
      if (task) {
        this.openDetail(task);
      } else {
        this.selectedTaskId = null;
      }
    }

    this._rendering = false;
  }

  private renderColumn(col: { id: KanbanStatus; label: string }, tasks: KanbanTask[]): HTMLElement {
    const colEl = document.createElement('div');
    colEl.className = 'kb-column';
    colEl.dataset.status = col.id;

    // Header
    const colHeader = document.createElement('div');
    colHeader.className = 'kb-col-header';
    const colTitle = document.createElement('span');
    colTitle.className = 'kb-col-title';
    colTitle.textContent = col.label;
    const colCount = document.createElement('span');
    colCount.className = 'kb-col-count';
    colCount.textContent = String(tasks.length);
    colHeader.appendChild(colTitle);
    colHeader.appendChild(colCount);
    colEl.appendChild(colHeader);

    // Body (droppable)
    const body = document.createElement('div');
    body.className = 'kb-col-body';

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('drag-over');
    });

    body.addEventListener('dragleave', (e) => {
      // Only remove if leaving the body itself, not a child
      if (!body.contains(e.relatedTarget as Node)) {
        body.classList.remove('drag-over');
      }
    });

    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const taskId = e.dataTransfer?.getData('text/plain');
      if (!taskId) return;
      const task = this.store.loadTask(taskId);
      if (!task || task.status === col.id) return;
      const fromStatus = task.status;
      this.store.moveTask(taskId, col.id);
      this.emit({ type: 'card-moved', taskId, from: fromStatus, to: col.id });
    });

    for (const task of tasks) {
      body.appendChild(this.renderCard(task));
    }
    colEl.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'kb-col-footer';
    const addBtn = document.createElement('button');
    addBtn.className = 'kb-add-btn';
    addBtn.textContent = '+ Add card';
    addBtn.addEventListener('click', () => this.startAddCard(col.id, footer, addBtn));
    footer.appendChild(addBtn);
    colEl.appendChild(footer);

    return colEl;
  }

  private renderCard(task: KanbanTask): HTMLElement {
    const card = document.createElement('div');
    card.className = 'kb-card';
    card.draggable = true;
    card.dataset.taskId = task.id;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', task.id);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    card.addEventListener('click', () => {
      const t = this.store.loadTask(task.id);
      if (t) this.openDetail(t);
    });

    // Card header: priority dot + title
    const cardHeader = document.createElement('div');
    cardHeader.className = 'kb-card-header';

    const dot = document.createElement('div');
    dot.className = 'kb-priority-dot';
    dot.style.background = PRIORITY_COLORS[task.priority];
    dot.title = task.priority;
    cardHeader.appendChild(dot);

    const titleEl = document.createElement('div');
    titleEl.className = 'kb-card-title';
    titleEl.textContent = task.title;
    cardHeader.appendChild(titleEl);
    card.appendChild(cardHeader);

    // Card footer: tags + assignee badge
    if (task.tags.length > 0 || task.assignee) {
      const cardFooter = document.createElement('div');
      cardFooter.className = 'kb-card-footer';

      const tagsEl = document.createElement('div');
      tagsEl.className = 'kb-card-tags';
      for (const tag of task.tags.slice(0, 3)) {
        const tagEl = document.createElement('span');
        tagEl.className = 'kb-tag';
        tagEl.textContent = tag;
        tagsEl.appendChild(tagEl);
      }
      cardFooter.appendChild(tagsEl);

      if (task.assignee) {
        const badge = document.createElement('span');
        badge.className = 'kb-assignee-badge ' + (task.assignee_type ?? 'human');
        const assigneeObj = this.options.assignees.find((a) => a.id === task.assignee);
        const name = assigneeObj?.name ?? task.assignee;
        badge.textContent = name.substring(0, 2).toUpperCase();
        badge.title = name;
        cardFooter.appendChild(badge);
      }

      card.appendChild(cardFooter);
    }

    return card;
  }

  private startAddCard(status: KanbanStatus, footer: HTMLElement, addBtn: HTMLButtonElement): void {
    addBtn.style.display = 'none';

    const input = document.createElement('input');
    input.className = 'kb-add-input';
    input.placeholder = 'Card title…';
    footer.appendChild(input);
    input.focus();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const title = input.value.trim();
      if (title) {
        const task = this.store.createTask({ title, status });
        this.emit({ type: 'card-created', taskId: task.id });
      }
      input.remove();
      addBtn.style.display = '';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') {
        committed = true;
        input.remove();
        addBtn.style.display = '';
      }
    });

    input.addEventListener('blur', commit);
  }

  private openDetail(task: KanbanTask): void {
    this.selectedTaskId = task.id;
    if (!this.detailPanel || !this.detailOverlay) return;

    this.detailOverlay.classList.add('open');
    this.detailPanel.classList.add('open');
    this.detailPanel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'kb-detail-header';
    const headerLabel = document.createElement('span');
    headerLabel.style.cssText = 'font-size:11px;color:#737aa2;font-weight:600;text-transform:uppercase;letter-spacing:.05em';
    headerLabel.textContent = 'Task';
    header.appendChild(headerLabel);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'kb-detail-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.closeDetail());
    header.appendChild(closeBtn);
    this.detailPanel.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'kb-detail-body';

    // Title field
    body.appendChild(this.mkLabel('Title'));
    const titleInput = document.createElement('input');
    titleInput.className = 'kb-field-input';
    titleInput.value = task.title;
    body.appendChild(titleInput);

    // Description field
    body.appendChild(this.mkLabel('Description'));
    const descInput = document.createElement('textarea');
    descInput.className = 'kb-field-input';
    descInput.value = task.description;
    body.appendChild(descInput);

    // Status field
    body.appendChild(this.mkLabel('Status'));
    const statusSelect = document.createElement('select');
    statusSelect.className = 'kb-field-select';
    for (const col of COLUMNS) {
      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = col.label;
      opt.selected = task.status === col.id;
      statusSelect.appendChild(opt);
    }
    body.appendChild(statusSelect);

    // Priority field
    body.appendChild(this.mkLabel('Priority'));
    const prioritySelect = document.createElement('select');
    prioritySelect.className = 'kb-field-select';
    for (const p of ['none', 'low', 'medium', 'high'] as KanbanPriority[]) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      opt.selected = task.priority === p;
      prioritySelect.appendChild(opt);
    }
    body.appendChild(prioritySelect);

    // Assignee field
    let assigneeSelect: HTMLSelectElement | null = null;
    if (this.options.assignees.length > 0) {
      body.appendChild(this.mkLabel('Assignee'));
      assigneeSelect = document.createElement('select');
      assigneeSelect.className = 'kb-field-select';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'Unassigned';
      assigneeSelect.appendChild(noneOpt);
      for (const a of this.options.assignees) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name + (a.type === 'agent' ? ' 🤖' : '');
        opt.selected = task.assignee === a.id;
        assigneeSelect.appendChild(opt);
      }
      body.appendChild(assigneeSelect);
    }

    // Activity log
    if (task.activity.length > 0) {
      body.appendChild(this.mkLabel('Activity'));
      const actList = document.createElement('div');
      actList.className = 'kb-activity-list';
      for (const entry of [...task.activity].reverse()) {
        const entryEl = document.createElement('div');
        entryEl.className = 'kb-activity-entry';
        const msg = document.createElement('div');
        msg.className = 'kb-act-message';
        msg.textContent = entry.message;
        const meta = document.createElement('div');
        meta.className = 'kb-act-meta';
        meta.textContent = `${entry.by} · ${new Date(entry.timestamp).toLocaleString()}`;
        entryEl.appendChild(msg);
        entryEl.appendChild(meta);
        actList.appendChild(entryEl);
      }
      body.appendChild(actList);
    }

    this.detailPanel.appendChild(body);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'kb-detail-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'kb-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const updated = this.store.loadTask(task.id);
      if (!updated) return;

      const newTitle = titleInput.value.trim() || updated.title;
      const newDesc = descInput.value;
      const newStatus = statusSelect.value as KanbanStatus;
      const newPriority = prioritySelect.value as KanbanPriority;
      const newAssigneeId = assigneeSelect?.value || null;

      let changed = false;

      if (newTitle !== updated.title || newDesc !== updated.description ||
          newStatus !== updated.status || newPriority !== updated.priority) {
        updated.title = newTitle;
        updated.description = newDesc;
        updated.status = newStatus;
        updated.priority = newPriority;
        updated.activity.push({
          type: 'updated',
          message: 'Task updated',
          by: 'user',
          timestamp: new Date().toISOString(),
        });
        changed = true;
      }

      if (newAssigneeId !== updated.assignee) {
        const assigneeObj = this.options.assignees.find((a) => a.id === newAssigneeId);
        updated.assignee = newAssigneeId;
        updated.assignee_type = assigneeObj?.type ?? null;
        updated.activity.push({
          type: 'assigned',
          message: newAssigneeId ? `Assigned to ${assigneeObj?.name ?? newAssigneeId}` : 'Unassigned',
          by: 'user',
          timestamp: new Date().toISOString(),
        });
        this.emit({ type: 'card-assigned', taskId: task.id, assignee: newAssigneeId });
        changed = true;
      }

      if (changed) {
        this.store.saveTask(updated);
        this.emit({ type: 'card-updated', taskId: task.id });
      }
      this.closeDetail();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'kb-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      this.selectedTaskId = null;
      this.closeDetail();
      this.store.deleteTask(task.id);
      this.emit({ type: 'card-deleted', taskId: task.id });
    });

    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    this.detailPanel.appendChild(actions);
  }

  private closeDetail(): void {
    this.selectedTaskId = null;
    this.detailPanel?.classList.remove('open');
    this.detailOverlay?.classList.remove('open');
  }

  private mkLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'kb-field-label';
    el.textContent = text;
    return el;
  }
}
