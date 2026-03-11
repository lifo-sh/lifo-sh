import type { VFS } from '@lifo-sh/core';

const vfsContent = document.getElementById('vfs-content')!;
const vfsTree = document.getElementById('vfs-tree')!;
const vfsPathEl = document.getElementById('vfs-path')!;
const vfsToggleBtn = document.getElementById('vfs-toggle-btn')!;

let currentPath = '/';
let vfs: VFS | null = null;
let open = false;

export function initVfsInspector(vfsInstance: VFS) {
  vfs = vfsInstance;

  vfsToggleBtn.addEventListener('click', () => {
    open = !open;
    vfsContent.classList.toggle('hidden', !open);
    if (open) refresh();
  });
}

export function refresh() {
  if (!vfs || !open) return;
  renderDir(currentPath);
}

function navigateTo(dirPath: string) {
  currentPath = dirPath;
  vfsPathEl.textContent = dirPath;
  refresh();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function renderDir(dirPath: string) {
  if (!vfs) return;
  vfsTree.innerHTML = '';

  try {
    const entries = vfs.readdir(dirPath);

    // Parent directory link
    if (dirPath !== '/') {
      const parent = dirPath.replace(/\/[^/]+$/, '') || '/';
      const el = createEntry('..', 'dir', '', () => navigateTo(parent));
      vfsTree.appendChild(el);
    }

    // Sort: directories first, then alphabetical
    const sorted = [...entries].sort((a, b) => {
      const aDir = a.type === 'directory';
      const bDir = b.type === 'directory';
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const fullPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;
      const isDir = entry.type === 'directory';

      let sizeStr = '';
      if (!isDir) {
        try {
          const stat = vfs.stat(fullPath);
          sizeStr = formatSize(stat.size);
        } catch {
          sizeStr = '?';
        }
      }

      const el = createEntry(
        entry.name,
        isDir ? 'dir' : 'file',
        sizeStr,
        isDir
          ? () => navigateTo(fullPath)
          : () => loadFileInEditor(fullPath),
      );
      vfsTree.appendChild(el);
    }

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color: var(--text-muted); font-style: italic; padding: 4px;';
      empty.textContent = '(empty directory)';
      vfsTree.appendChild(empty);
    }
  } catch (e: any) {
    const err = document.createElement('div');
    err.style.cssText = 'color: var(--red);';
    err.textContent = `Error: ${e.message}`;
    vfsTree.appendChild(err);
  }
}

function createEntry(
  name: string,
  type: 'dir' | 'file',
  size: string,
  onClick: () => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = `vfs-entry ${type}`;
  el.innerHTML = `
    <span class="icon">${type === 'dir' ? '\u{1F4C1}' : '\u{1F4C4}'}</span>
    <span class="name">${escapeHtml(name)}</span>
    ${size ? `<span class="size">${size}</span>` : ''}
  `;
  el.addEventListener('click', onClick);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Callback to load a file into the editor (set by main.ts)
let _loadFileCallback: ((path: string) => void) | null = null;

export function setLoadFileCallback(cb: (path: string) => void) {
  _loadFileCallback = cb;
}

function loadFileInEditor(filePath: string) {
  if (_loadFileCallback) {
    _loadFileCallback(filePath);
  }
}
