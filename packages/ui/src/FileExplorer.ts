import type { VFS } from '@lifo-sh/core';

// ─── Types ───

export interface EditorInstance {
  getValue(): string;
  onDidChangeContent(callback: () => void): void;
  dispose(): void;
}

export interface EditorProvider {
  create(container: HTMLElement, content: string, language: string): EditorInstance;
}

export interface FileExplorerOptions {
  /** Initial directory to show */
  cwd?: string;
  /** Show hidden files (starting with .) */
  showHidden?: boolean;
  /** Optional editor provider (e.g. Monaco). Falls back to textarea. */
  editorProvider?: EditorProvider;
}

export interface FileExplorerEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  mode: number;
}

export type FileExplorerEvent =
  | { type: 'open'; path: string; fileType: 'file' | 'directory' }
  | { type: 'select'; path: string; fileType: 'file' | 'directory' }
  | { type: 'navigate'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'create'; path: string; fileType: 'file' | 'directory' };

type EventHandler = (event: FileExplorerEvent) => void;

// ─── Styles ───

const STYLES = `
.lf-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  color: #a9b1d6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  overflow: hidden;
  background: #1a1b26;
}

/* ── Toolbar ── */
.lf-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #2f3146;
  background: #16161e;
  min-height: 36px;
  flex-shrink: 0;
}
.lf-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #565f89;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.15s, color 0.15s;
}
.lf-toolbar-btn:hover {
  background: #1e2030;
  color: #a9b1d6;
}
.lf-toolbar-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ── Breadcrumbs ── */
.lf-breadcrumbs {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding: 0 4px;
  gap: 2px;
}
.lf-breadcrumbs::-webkit-scrollbar { display: none; }
.lf-crumb {
  background: none;
  border: none;
  color: #565f89;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.lf-crumb:hover {
  background: #1e2030;
  color: #7aa2f7;
}
.lf-crumb-sep {
  color: #2f3146;
  font-size: 11px;
  user-select: none;
}

/* ── Main area (split: tree + list) ── */
.lf-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── Tree sidebar ── */
.lf-tree {
  width: 180px;
  min-width: 140px;
  border-right: 1px solid #2f3146;
  overflow-y: auto;
  padding: 4px 0;
  flex-shrink: 0;
  background: #16161e;
}
.lf-tree::-webkit-scrollbar { width: 4px; }
.lf-tree::-webkit-scrollbar-thumb { background: #2f3146; border-radius: 2px; }

.lf-tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: #9aa5ce;
  transition: background 0.1s;
  user-select: none;
}
.lf-tree-item:hover {
  background: #1e2030;
}
.lf-tree-item.active {
  background: #292e42;
  color: #7aa2f7;
}
.lf-tree-chevron {
  display: inline-flex;
  width: 14px;
  font-size: 10px;
  color: #565f89;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.lf-tree-chevron.open {
  transform: rotate(90deg);
}
.lf-tree-icon {
  flex-shrink: 0;
  font-size: 13px;
}
.lf-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.lf-tree-children {
  padding-left: 12px;
}

/* ── File list (main panel) ── */
.lf-list {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  min-height: 0;
}
.lf-list.viewing {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.lf-list::-webkit-scrollbar { width: 6px; }
.lf-list::-webkit-scrollbar-thumb { background: #2f3146; border-radius: 3px; }

.lf-list-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px 140px;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #2f3146;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #565f89;
  position: sticky;
  top: 0;
  background: #1a1b26;
  z-index: 1;
}

.lf-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px 140px;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
  align-items: center;
  min-height: 30px;
}
.lf-list-row:hover {
  background: #1e2030;
}
.lf-list-row.selected {
  background: #292e42;
}

.lf-list-name {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  font-size: 13px;
}
.lf-list-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lf-list-name .lf-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.lf-list-size {
  text-align: right;
  font-size: 12px;
  color: #565f89;
  font-variant-numeric: tabular-nums;
}

.lf-list-modified {
  font-size: 12px;
  color: #565f89;
}

.lf-list-empty {
  padding: 24px;
  text-align: center;
  color: #565f89;
  font-size: 12px;
}

/* ── Editor / Viewer panel ── */
.lf-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.lf-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #2f3146;
  background: #16161e;
  min-height: 36px;
  flex-shrink: 0;
}
.lf-viewer-filename {
  font-size: 12px;
  font-weight: 500;
  color: #c0caf5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lf-viewer-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.lf-viewer-btn {
  padding: 4px 10px;
  border: 1px solid #2f3146;
  border-radius: 4px;
  background: transparent;
  color: #9aa5ce;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.lf-viewer-btn:hover {
  background: #1e2030;
  color: #c0caf5;
}
.lf-viewer-btn.primary {
  background: #7aa2f7;
  color: #1a1b26;
  border-color: #7aa2f7;
}
.lf-viewer-btn.primary:hover {
  background: #89b4fa;
}
.lf-viewer-textarea {
  flex: 1;
  width: 100%;
  padding: 12px;
  background: #1a1b26;
  color: #a9b1d6;
  border: none;
  resize: none;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  tab-size: 2;
  min-height: 0;
}
.lf-editor-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

/* ── Drag-and-drop overlay ── */
.lf-drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(122, 162, 247, 0.08);
  border: 2px dashed #7aa2f7;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
}
.lf-drop-overlay span {
  background: #292e42;
  color: #7aa2f7;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

/* ── Context menu ── */
.lf-context-menu {
  position: fixed;
  z-index: 1000;
  background: #16161e;
  border: 1px solid #2f3146;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.lf-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: #a9b1d6;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.lf-context-item:hover {
  background: #292e42;
}
.lf-context-item.danger {
  color: #f7768e;
}
.lf-context-sep {
  height: 1px;
  background: #2f3146;
  margin: 4px 0;
}

/* ── Rename input ── */
.lf-rename-input {
  background: #1a1b26;
  color: #c0caf5;
  border: 1px solid #7aa2f7;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  width: 100%;
  min-width: 80px;
}
`;

// ─── Icon mapping ───

const FOLDER_ICON = '\u{1F4C1}';
const FILE_ICONS: Record<string, string> = {
  js: '\u{1F7E8}',
  ts: '\u{1F535}',
  json: '\u{1F7E0}',
  md: '\u{1F4D6}',
  txt: '\u{1F4C4}',
  sh: '\u{1F4DC}',
  html: '\u{1F7E7}',
  css: '\u{1F7E3}',
  py: '\u{1F40D}',
  default: '\u{1F4C4}',
};

function getFileIcon(name: string, type: 'file' | 'directory'): string {
  if (type === 'directory') return FOLDER_ICON;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function joinPath(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/');
  return joined === '' ? '/' : joined;
}

function dirname(path: string): string {
  if (path === '/') return '/';
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function basename(path: string): string {
  if (path === '/') return '/';
  const parts = path.split('/');
  return parts[parts.length - 1] || '/';
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
};

function getLanguageFromPath(path: string): string {
  const name = basename(path);
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return LANGUAGE_MAP[ext] || 'plaintext';
}

// ─── Tree Node State ───

interface TreeNode {
  name: string;
  path: string;
  expanded: boolean;
  children: TreeNode[] | null; // null = not yet loaded
}

// ─── FileExplorer ───

export class FileExplorer {
  private vfs: VFS;
  private container: HTMLElement;
  private root: HTMLElement;
  private showHidden: boolean;
  private editorProvider: EditorProvider | null;

  // State
  private currentPath: string;
  private entries: FileExplorerEntry[] = [];
  private selectedPath: string | null = null;
  private viewingFile: string | null = null; // path of file being viewed/edited
  private activeEditor: EditorInstance | null = null;
  private treeRoots: TreeNode[] = [];
  private historyStack: string[] = [];
  private historyIndex = -1;
  private contextMenu: HTMLElement | null = null;

  // DOM refs
  private breadcrumbsEl!: HTMLElement;
  private treeEl!: HTMLElement;
  private listEl!: HTMLElement;
  private backBtn!: HTMLButtonElement;
  private fwdBtn!: HTMLButtonElement;
  private upBtn!: HTMLButtonElement;

  // Events
  private listeners: EventHandler[] = [];

  // Style element
  private styleEl: HTMLStyleElement;

  constructor(container: HTMLElement, vfs: VFS, options: FileExplorerOptions = {}) {
    this.vfs = vfs;
    this.container = container;
    this.currentPath = options.cwd || '/';
    this.showHidden = options.showHidden ?? false;
    this.editorProvider = options.editorProvider ?? null;

    // Inject scoped styles
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    document.head.appendChild(this.styleEl);

    // Build DOM
    this.root = document.createElement('div');
    this.root.className = 'lf-explorer';
    this.container.appendChild(this.root);

    this.buildToolbar();
    this.buildBody();

    // Initialize tree
    this.treeRoots = [{ name: '/', path: '/', expanded: true, children: null }];
    this.loadTreeChildren(this.treeRoots[0]);

    // Initial navigation
    this.navigateTo(this.currentPath, false);

    // React to VFS changes
    const prevOnChange = this.vfs.onChange;
    this.vfs.onChange = () => {
      prevOnChange?.();
      this.refresh();
    };

    // Close context menu on click elsewhere
    this.handleDocClick = this.handleDocClick.bind(this);
    document.addEventListener('click', this.handleDocClick);

    // Keyboard navigation
    this.handleKeydown = this.handleKeydown.bind(this);
    this.root.tabIndex = 0;
    this.root.addEventListener('keydown', this.handleKeydown);

    // Drag-and-drop file upload
    this.setupDragAndDrop();
  }

  // ─── Public API ───

  on(handler: EventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  navigateTo(path: string, pushHistory = true): void {
    if (pushHistory && path !== this.currentPath) {
      // Truncate forward history
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
      this.historyStack.push(path);
      this.historyIndex = this.historyStack.length - 1;
    } else if (!pushHistory && this.historyStack.length === 0) {
      this.historyStack.push(path);
      this.historyIndex = 0;
    }

    this.currentPath = path;
    this.selectedPath = null;
    this.disposeEditor();
    this.viewingFile = null;
    this.loadEntries();
    this.renderBreadcrumbs();
    this.renderList();
    this.renderTree();
    this.updateNavButtons();
    this.emit({ type: 'navigate', path });
  }

  refresh(): void {
    this.loadEntries();
    this.renderList();
    // Refresh tree children for expanded nodes
    this.refreshTreeNode(this.treeRoots[0]);
    this.renderTree();
  }

  destroy(): void {
    this.disposeEditor();
    document.removeEventListener('click', this.handleDocClick);
    this.styleEl.remove();
    this.root.remove();
    this.closeContextMenu();
  }

  private disposeEditor(): void {
    if (this.activeEditor) {
      this.activeEditor.dispose();
      this.activeEditor = null;
    }
  }

  // ─── Build DOM ───

  private buildToolbar(): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'lf-toolbar';

    this.backBtn = this.createToolbarBtn('\u2190', 'Back');
    this.fwdBtn = this.createToolbarBtn('\u2192', 'Forward');
    this.upBtn = this.createToolbarBtn('\u2191', 'Up');

    this.backBtn.addEventListener('click', () => this.goBack());
    this.fwdBtn.addEventListener('click', () => this.goForward());
    this.upBtn.addEventListener('click', () => this.goUp());

    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:16px;background:#2f3146;margin:0 2px;';

    this.breadcrumbsEl = document.createElement('div');
    this.breadcrumbsEl.className = 'lf-breadcrumbs';

    toolbar.append(this.backBtn, this.fwdBtn, this.upBtn, sep, this.breadcrumbsEl);
    this.root.appendChild(toolbar);
  }

  private buildBody(): void {
    const body = document.createElement('div');
    body.className = 'lf-body';

    this.treeEl = document.createElement('div');
    this.treeEl.className = 'lf-tree';

    this.listEl = document.createElement('div');
    this.listEl.className = 'lf-list';

    body.append(this.treeEl, this.listEl);
    this.root.appendChild(body);
  }

  private createToolbarBtn(label: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'lf-toolbar-btn';
    btn.textContent = label;
    btn.title = title;
    return btn;
  }

  // ─── Data loading ───

  private loadEntries(): void {
    try {
      this.entries = [];
      const dirents = this.vfs.readdir(this.currentPath);
      for (const d of dirents) {
        if (!this.showHidden && d.name.startsWith('.')) continue;
        const fullPath = joinPath(this.currentPath, d.name);
        try {
          const st = this.vfs.stat(fullPath);
          this.entries.push({
            name: d.name,
            path: fullPath,
            type: st.type,
            size: st.size,
            mtime: st.mtime,
            mode: st.mode,
          });
        } catch {
          // skip files we can't stat (virtual providers may throw)
          this.entries.push({
            name: d.name,
            path: fullPath,
            type: d.type,
            size: 0,
            mtime: 0,
            mode: 0,
          });
        }
      }
      // Sort: directories first, then alphabetical
      this.entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      this.entries = [];
    }
  }

  // ─── Breadcrumbs ───

  private renderBreadcrumbs(): void {
    this.breadcrumbsEl.innerHTML = '';
    const parts = this.currentPath === '/' ? [''] : this.currentPath.split('/');

    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'lf-crumb-sep';
        sep.textContent = '/';
        this.breadcrumbsEl.appendChild(sep);
      }
      const crumb = document.createElement('button');
      crumb.className = 'lf-crumb';
      crumb.textContent = i === 0 ? '/' : parts[i];
      const targetPath = i === 0 ? '/' : parts.slice(0, i + 1).join('/');
      crumb.addEventListener('click', () => this.navigateTo(targetPath));
      this.breadcrumbsEl.appendChild(crumb);
    }

    // Auto-scroll to end
    this.breadcrumbsEl.scrollLeft = this.breadcrumbsEl.scrollWidth;
  }

  // ─── File list ───

  private renderList(): void {
    this.listEl.innerHTML = '';
    this.listEl.classList.remove('viewing');

    if (this.viewingFile) {
      this.renderFileViewer();
      return;
    }

    // Header
    const header = document.createElement('div');
    header.className = 'lf-list-header';
    header.innerHTML = '<div>Name</div><div style="text-align:right">Size</div><div>Modified</div>';
    this.listEl.appendChild(header);

    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lf-list-empty';
      empty.textContent = 'Empty directory';
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of this.entries) {
      const row = document.createElement('div');
      row.className = 'lf-list-row';
      if (entry.path === this.selectedPath) row.classList.add('selected');

      const nameCell = document.createElement('div');
      nameCell.className = 'lf-list-name';
      const icon = document.createElement('span');
      icon.className = 'lf-icon';
      icon.textContent = getFileIcon(entry.name, entry.type);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = entry.name;
      if (entry.type === 'directory') {
        nameSpan.style.color = '#7aa2f7';
      }
      nameCell.append(icon, nameSpan);

      const sizeCell = document.createElement('div');
      sizeCell.className = 'lf-list-size';
      sizeCell.textContent = entry.type === 'file' ? formatSize(entry.size) : '--';

      const modifiedCell = document.createElement('div');
      modifiedCell.className = 'lf-list-modified';
      modifiedCell.textContent = entry.mtime ? formatDate(entry.mtime) : '--';

      row.append(nameCell, sizeCell, modifiedCell);

      // Click to select
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(entry);
      });

      // Double-click to open
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.openEntry(entry);
      });

      // Right-click context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.select(entry);
        this.showContextMenu(e.clientX, e.clientY, entry);
      });

      this.listEl.appendChild(row);
    }

    // Right-click on empty area
    this.listEl.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.lf-list-row')) return;
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, null);
    });
  }

  private renderFileViewer(): void {
    const path = this.viewingFile!;
    this.disposeEditor();

    // Add viewing class so list becomes a flex column
    this.listEl.classList.add('viewing');

    const viewer = document.createElement('div');
    viewer.className = 'lf-viewer';

    // Header
    const header = document.createElement('div');
    header.className = 'lf-viewer-header';

    const filename = document.createElement('div');
    filename.className = 'lf-viewer-filename';
    filename.textContent = basename(path);

    const actions = document.createElement('div');
    actions.className = 'lf-viewer-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lf-viewer-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      this.disposeEditor();
      this.viewingFile = null;
      this.renderList();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'lf-viewer-btn primary';
    saveBtn.textContent = 'Save';
    saveBtn.style.display = 'none';

    actions.append(saveBtn, closeBtn);
    header.append(filename, actions);
    viewer.appendChild(header);

    // Content
    let content: string;
    try {
      content = this.vfs.readFileString(path);
    } catch {
      content = '(Unable to read file)';
    }

    const language = getLanguageFromPath(path);

    if (this.editorProvider) {
      // Use provided editor (e.g. Monaco)
      const editorContainer = document.createElement('div');
      editorContainer.className = 'lf-editor-container';
      viewer.appendChild(editorContainer);
      this.listEl.appendChild(viewer);

      // Create editor after DOM is attached so it can measure size
      requestAnimationFrame(() => {
        const editor = this.editorProvider!.create(editorContainer, content, language);
        this.activeEditor = editor;

        editor.onDidChangeContent(() => {
          saveBtn.style.display = '';
        });

        saveBtn.addEventListener('click', () => {
          this.vfs.writeFile(path, editor.getValue());
          saveBtn.style.display = 'none';
        });
      });
    } else {
      // Textarea fallback
      const textarea = document.createElement('textarea');
      textarea.className = 'lf-viewer-textarea';
      textarea.value = content;
      textarea.spellcheck = false;

      textarea.addEventListener('input', () => {
        saveBtn.style.display = '';
      });

      saveBtn.addEventListener('click', () => {
        this.vfs.writeFile(path, textarea.value);
        saveBtn.style.display = 'none';
      });

      viewer.appendChild(textarea);
      this.listEl.appendChild(viewer);

      requestAnimationFrame(() => textarea.focus());
    }
  }

  // ─── Tree ───

  private loadTreeChildren(node: TreeNode): void {
    try {
      const dirents = this.vfs.readdir(node.path);
      const dirs = dirents
        .filter((d) => d.type === 'directory' && (this.showHidden || !d.name.startsWith('.')))
        .sort((a, b) => a.name.localeCompare(b.name));
      node.children = dirs.map((d) => ({
        name: d.name,
        path: joinPath(node.path, d.name),
        expanded: false,
        children: null,
      }));
    } catch {
      node.children = [];
    }
  }

  private refreshTreeNode(node: TreeNode): void {
    if (node.expanded && node.children) {
      // Preserve expanded state
      const expandedPaths = new Set(
        node.children.filter((c) => c.expanded).map((c) => c.path),
      );
      this.loadTreeChildren(node);
      for (const child of node.children!) {
        if (expandedPaths.has(child.path)) {
          child.expanded = true;
          this.loadTreeChildren(child);
          this.refreshTreeNode(child);
        }
      }
    }
  }

  private renderTree(): void {
    this.treeEl.innerHTML = '';
    for (const root of this.treeRoots) {
      this.renderTreeNode(root, this.treeEl);
    }
  }

  private renderTreeNode(node: TreeNode, parent: HTMLElement): void {
    const item = document.createElement('div');
    item.className = 'lf-tree-item';
    if (node.path === this.currentPath) item.classList.add('active');

    const chevron = document.createElement('span');
    chevron.className = 'lf-tree-chevron' + (node.expanded ? ' open' : '');
    chevron.textContent = '\u25B6';

    const icon = document.createElement('span');
    icon.className = 'lf-tree-icon';
    icon.textContent = node.expanded ? '\u{1F4C2}' : FOLDER_ICON;

    const label = document.createElement('span');
    label.className = 'lf-tree-label';
    label.textContent = node.name;

    item.append(chevron, icon, label);

    // Click to navigate and toggle expand
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.expanded) {
        // If clicking the active node, toggle collapse
        if (node.path === this.currentPath) {
          node.expanded = false;
          this.renderTree();
          return;
        }
      }
      node.expanded = true;
      if (!node.children) this.loadTreeChildren(node);
      this.navigateTo(node.path);
    });

    // Right-click on tree
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e.clientX, e.clientY, {
        name: node.name,
        path: node.path,
        type: 'directory',
        size: 0,
        mtime: 0,
        mode: 0,
      });
    });

    parent.appendChild(item);

    // Children
    if (node.expanded && node.children && node.children.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.className = 'lf-tree-children';
      for (const child of node.children) {
        this.renderTreeNode(child, childContainer);
      }
      parent.appendChild(childContainer);
    }
  }

  // ─── Selection & navigation helpers ───

  private select(entry: FileExplorerEntry): void {
    this.selectedPath = entry.path;
    // Update highlight
    this.listEl.querySelectorAll('.lf-list-row').forEach((row, i) => {
      row.classList.toggle('selected', this.entries[i]?.path === entry.path);
    });
    this.emit({ type: 'select', path: entry.path, fileType: entry.type });
  }

  private openEntry(entry: FileExplorerEntry): void {
    if (entry.type === 'directory') {
      // Expand in tree
      this.expandTreePath(entry.path);
      this.navigateTo(entry.path);
    } else {
      this.viewingFile = entry.path;
      this.renderList();
    }
    this.emit({ type: 'open', path: entry.path, fileType: entry.type });
  }

  private expandTreePath(path: string): void {
    // Walk tree and expand nodes along the path
    const parts = path.split('/').filter(Boolean);
    let currentNodes = this.treeRoots;
    let currentPath = '/';

    // Expand root
    if (currentNodes[0]) {
      currentNodes[0].expanded = true;
      if (!currentNodes[0].children) this.loadTreeChildren(currentNodes[0]);
    }

    for (const part of parts) {
      currentPath = joinPath(currentPath, part);
      const parent = currentNodes[0]?.children;
      if (!parent) break;
      const node = parent.find((n) => n.path === currentPath);
      if (node) {
        node.expanded = true;
        if (!node.children) this.loadTreeChildren(node);
        currentNodes = [node];
      } else {
        break;
      }
    }
  }

  private goBack(): void {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const path = this.historyStack[this.historyIndex];
      this.navigateTo(path, false);
    }
  }

  private goForward(): void {
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyIndex++;
      const path = this.historyStack[this.historyIndex];
      this.navigateTo(path, false);
    }
  }

  private goUp(): void {
    if (this.currentPath !== '/') {
      this.navigateTo(dirname(this.currentPath));
    }
  }

  private updateNavButtons(): void {
    this.backBtn.disabled = this.historyIndex <= 0;
    this.fwdBtn.disabled = this.historyIndex >= this.historyStack.length - 1;
    this.upBtn.disabled = this.currentPath === '/';
  }

  // ─── Context menu ───

  private showContextMenu(x: number, y: number, entry: FileExplorerEntry | null): void {
    this.closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'lf-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    if (entry) {
      // Context on a file/directory
      if (entry.type === 'directory') {
        menu.appendChild(this.contextItem('Open', () => this.openEntry(entry)));
      } else {
        menu.appendChild(this.contextItem('View / Edit', () => this.openEntry(entry)));
      }
      menu.appendChild(this.contextSep());
      menu.appendChild(
        this.contextItem('Rename', () => this.startRename(entry)),
      );
      menu.appendChild(
        this.contextItem('Delete', () => this.deleteEntry(entry), true),
      );
    }

    // Always show create options
    if (entry) menu.appendChild(this.contextSep());
    menu.appendChild(
      this.contextItem('New File', () => this.createNew('file')),
    );
    menu.appendChild(
      this.contextItem('New Folder', () => this.createNew('directory')),
    );

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Adjust if off-screen
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = window.innerWidth - rect.width - 8 + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = window.innerHeight - rect.height - 8 + 'px';
      }
    });
  }

  private contextItem(label: string, action: () => void, danger = false): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'lf-context-item' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeContextMenu();
      action();
    });
    return btn;
  }

  private contextSep(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'lf-context-sep';
    return sep;
  }

  private closeContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private handleDocClick = (): void => {
    this.closeContextMenu();
  };

  // ─── File operations ───

  private startRename(entry: FileExplorerEntry): void {
    // Find the row in the list
    const rows = this.listEl.querySelectorAll('.lf-list-row');
    const idx = this.entries.indexOf(entry);
    if (idx < 0 || !rows[idx]) return;

    const nameCell = rows[idx].querySelector('.lf-list-name span:last-child');
    if (!nameCell) return;

    const oldName = entry.name;
    const input = document.createElement('input');
    input.className = 'lf-rename-input';
    input.value = oldName;

    nameCell.replaceWith(input);
    input.focus();
    // Select filename without extension
    const dotIdx = oldName.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : oldName.length);

    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        try {
          const newPath = joinPath(this.currentPath, newName);
          this.vfs.rename(entry.path, newPath);
        } catch {
          // Rename failed, just refresh
        }
      }
      this.refresh();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); this.refresh(); }
    });
    input.addEventListener('blur', commit);
  }

  private deleteEntry(entry: FileExplorerEntry): void {
    try {
      if (entry.type === 'directory') {
        this.vfs.rmdirRecursive(entry.path);
      } else {
        this.vfs.unlink(entry.path);
      }
      this.emit({ type: 'delete', path: entry.path });
    } catch {
      // Deletion failed
    }
    this.refresh();
  }

  private createNew(type: 'file' | 'directory'): void {
    const baseName = type === 'file' ? 'untitled' : 'new-folder';
    let name = baseName;
    let counter = 1;

    // Find unique name
    const existingNames = new Set(this.entries.map((e) => e.name));
    while (existingNames.has(name)) {
      name = type === 'file' ? `${baseName}-${counter}` : `${baseName}-${counter}`;
      counter++;
    }

    const fullPath = joinPath(this.currentPath, name);
    try {
      if (type === 'directory') {
        this.vfs.mkdir(fullPath);
      } else {
        this.vfs.writeFile(fullPath, '');
      }
      this.emit({ type: 'create', path: fullPath, fileType: type });
    } catch {
      // Creation failed
    }
    this.refresh();

    // Start rename on the new entry immediately
    requestAnimationFrame(() => {
      const entry = this.entries.find((e) => e.path === fullPath);
      if (entry) this.startRename(entry);
    });
  }

  // ─── Drag-and-drop upload ───

  private setupDragAndDrop(): void {
    let dragCounter = 0;
    let overlay: HTMLElement | null = null;

    const showOverlay = () => {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'lf-drop-overlay';
      const label = document.createElement('span');
      label.textContent = 'Drop files to upload';
      overlay.appendChild(label);
      this.root.style.position = 'relative';
      this.root.appendChild(overlay);
    };

    const hideOverlay = () => {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    };

    this.root.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) showOverlay();
    });

    this.root.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        hideOverlay();
      }
    });

    this.root.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      hideOverlay();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      this.uploadFiles(files);
    });
  }

  private uploadFiles(files: FileList): void {
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result === null) return;
        const destPath = joinPath(this.currentPath, file.name);
        if (result instanceof ArrayBuffer) {
          this.vfs.writeFile(destPath, new Uint8Array(result));
        } else {
          this.vfs.writeFile(destPath, result as string);
        }
        this.emit({ type: 'create', path: destPath, fileType: 'file' });
        this.refresh();
      };
      reader.readAsArrayBuffer(file);
    }
  }

  // ─── Keyboard ───

  private handleKeydown = (e: KeyboardEvent): void => {
    // Don't handle if we're in an input, textarea, or the editor is active
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      this.viewingFile
    ) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const currentIdx = this.selectedPath
          ? this.entries.findIndex((en) => en.path === this.selectedPath)
          : -1;
        const nextIdx = Math.min(currentIdx + 1, this.entries.length - 1);
        if (this.entries[nextIdx]) this.select(this.entries[nextIdx]);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const currentIdx = this.selectedPath
          ? this.entries.findIndex((en) => en.path === this.selectedPath)
          : this.entries.length;
        const prevIdx = Math.max(currentIdx - 1, 0);
        if (this.entries[prevIdx]) this.select(this.entries[prevIdx]);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const entry = this.entries.find((en) => en.path === this.selectedPath);
        if (entry) this.openEntry(entry);
        break;
      }
      case 'Backspace': {
        e.preventDefault();
        this.goUp();
        break;
      }
      case 'Delete': {
        e.preventDefault();
        const entry = this.entries.find((en) => en.path === this.selectedPath);
        if (entry) this.deleteEntry(entry);
        break;
      }
    }
  };

  // ─── Events ───

  private emit(event: FileExplorerEvent): void {
    for (const h of this.listeners) {
      h(event);
    }
  }
}
