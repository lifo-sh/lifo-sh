import type { VFS } from '@lifo-sh/core';
import type { AppRegistry } from './AppRegistry';

export class Desktop {
  readonly root: HTMLElement;
  readonly windowLayer: HTMLElement;
  private iconsContainer: HTMLElement;
  private contextMenu: HTMLElement | null = null;

  private onOpenFile?: (path: string) => void;

  constructor(
    container: HTMLElement,
    private vfs: VFS,
    _appRegistry: AppRegistry,
    onOpenFile?: (path: string) => void,
  ) {
    this.onOpenFile = onOpenFile;
    this.root = document.createElement('div');
    this.root.className = 'lf-desktop';

    this.windowLayer = document.createElement('div');
    this.windowLayer.className = 'lf-window-layer';

    this.iconsContainer = document.createElement('div');
    this.iconsContainer.className = 'lf-desktop-icons';

    this.root.append(this.iconsContainer, this.windowLayer);
    container.appendChild(this.root);

    // Context menu on desktop background
    this.root.addEventListener('contextmenu', (e) => {
      if (e.target === this.root || (e.target as HTMLElement).closest('.lf-desktop-icons')) {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY);
      }
    });

    // Dismiss context menu on click
    document.addEventListener('pointerdown', () => this.hideContextMenu());

    // Load desktop icons
    this.loadDesktopIcons();
  }

  async loadDesktopIcons(): Promise<void> {
    try {
      const entries = await this.vfs.readdir('/home/user/Desktop');
      this.iconsContainer.innerHTML = '';

      for (const entry of entries) {
        const icon = document.createElement('div');
        icon.className = 'lf-desktop-icon';

        const isDir = entry.type === 'directory';
        const emoji = isDir ? '\uD83D\uDCC1' : this.getFileEmoji(entry.name);

        icon.innerHTML = `
          <div class="lf-desktop-icon-emoji">${emoji}</div>
          <div class="lf-desktop-icon-label">${entry.name}</div>
        `;

        icon.addEventListener('click', () => {
          this.iconsContainer.querySelectorAll('.lf-desktop-icon').forEach((i) => i.classList.remove('selected'));
          icon.classList.add('selected');
        });

        icon.addEventListener('dblclick', () => {
          this.onOpenFile?.(`/home/user/Desktop/${entry.name}`);
        });

        this.iconsContainer.appendChild(icon);
      }
    } catch {
      // Desktop dir may not exist yet
    }
  }

  private getFileEmoji(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'txt': case 'md': return '\uD83D\uDCC4';
      case 'js': case 'ts': case 'py': return '\uD83D\uDCDC';
      case 'png': case 'jpg': case 'gif': return '\uD83D\uDDBC\uFE0F';
      case 'mp3': case 'wav': return '\uD83C\uDFB5';
      default: return '\uD83D\uDCC4';
    }
  }

  private showContextMenu(x: number, y: number): void {
    this.hideContextMenu();

    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'lf-context-menu';
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;

    const items: Array<{ label: string; action: () => void } | { separator: true }> = [
      { label: 'New Folder', action: () => this.createDesktopItem('directory') },
      { label: 'New File', action: () => this.createDesktopItem('file') },
      { separator: true },
      { label: 'Refresh', action: () => this.loadDesktopIcons() },
    ];

    for (const item of items) {
      if ('separator' in item) {
        const sep = document.createElement('div');
        sep.className = 'lf-context-menu-separator';
        this.contextMenu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'lf-context-menu-item';
        el.textContent = item.label;
        el.addEventListener('click', () => {
          item.action();
          this.hideContextMenu();
        });
        this.contextMenu.appendChild(el);
      }
    }

    document.body.appendChild(this.contextMenu);
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private async createDesktopItem(type: 'file' | 'directory'): Promise<void> {
    const base = '/home/user/Desktop';
    try {
      await this.vfs.mkdir(base, { recursive: true });
    } catch { /* exists */ }

    const name = type === 'directory' ? 'untitled folder' : 'untitled.txt';
    const path = `${base}/${name}`;

    try {
      if (type === 'directory') {
        await this.vfs.mkdir(path);
      } else {
        await this.vfs.writeFile(path, '');
      }
      this.loadDesktopIcons();
    } catch { /* may already exist */ }
  }
}
