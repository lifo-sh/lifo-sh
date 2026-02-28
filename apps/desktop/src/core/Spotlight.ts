import type { VFS } from '@lifo-sh/core';
import type { AppRegistry } from './AppRegistry';
import type { AppDefinition } from '../types';

interface SpotlightResult {
  type: 'app' | 'file';
  name: string;
  icon: string;
  path?: string;
  appId?: string;
}

export class Spotlight {
  private overlay: HTMLElement;
  private box: HTMLElement;
  private input: HTMLInputElement;
  private resultsList: HTMLElement;
  private results: SpotlightResult[] = [];
  private selectedIndex = 0;
  private visible = false;

  private onLaunchApp: (appId: string) => void;
  private onOpenFile: (path: string) => void;

  constructor(
    private container: HTMLElement,
    private appRegistry: AppRegistry,
    private vfs: VFS,
    onLaunchApp: (appId: string) => void,
    onOpenFile: (path: string) => void,
  ) {
    this.onLaunchApp = onLaunchApp;
    this.onOpenFile = onOpenFile;

    // Build overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'lf-spotlight-overlay';

    this.box = document.createElement('div');
    this.box.className = 'lf-spotlight-box';

    this.input = document.createElement('input');
    this.input.className = 'lf-spotlight-input';
    this.input.type = 'text';
    this.input.placeholder = 'Spotlight Search';

    this.resultsList = document.createElement('div');
    this.resultsList.className = 'lf-spotlight-results';

    this.box.append(this.input, this.resultsList);
    this.overlay.appendChild(this.box);
    this.container.appendChild(this.overlay);

    // Prevent global shortcuts while typing
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        this.hide();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.renderResults();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.renderResults();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        this.activateSelected();
        return;
      }
    });

    this.input.addEventListener('input', () => {
      this.search(this.input.value.trim());
    });

    // Click backdrop to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.overlay.classList.add('visible');
    this.input.value = '';
    this.results = [];
    this.selectedIndex = 0;
    this.resultsList.innerHTML = '';
    requestAnimationFrame(() => this.input.focus());
  }

  hide(): void {
    this.visible = false;
    this.overlay.classList.remove('visible');
    this.input.blur();
  }

  private search(query: string): void {
    this.results = [];
    if (!query) {
      this.renderResults();
      return;
    }

    const q = query.toLowerCase();

    // Search apps
    const apps = this.appRegistry.getAll();
    for (const app of apps) {
      if (app.name.toLowerCase().includes(q) || app.id.toLowerCase().includes(q)) {
        this.results.push({
          type: 'app',
          name: app.name,
          icon: app.icon,
          appId: app.id,
        });
      }
    }

    // Search VFS files
    const searchDirs = ['/home/user', '/home/user/Desktop', '/home/user/Documents'];
    const seenPaths = new Set<string>();

    for (const dir of searchDirs) {
      try {
        const entries = this.vfs.readdir(dir);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
          if (seenPaths.has(fullPath)) continue;
          if (entry.name.toLowerCase().includes(q)) {
            seenPaths.add(fullPath);
            const icon = entry.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}';
            this.results.push({
              type: 'file',
              name: entry.name,
              icon,
              path: fullPath,
            });
          }
        }
      } catch {
        // dir doesn't exist, skip
      }
    }

    // Cap at 10
    this.results = this.results.slice(0, 10);
    this.selectedIndex = 0;
    this.renderResults();
  }

  private renderResults(): void {
    this.resultsList.innerHTML = '';

    for (let i = 0; i < this.results.length; i++) {
      const r = this.results[i];
      const row = document.createElement('div');
      row.className = 'lf-spotlight-row';
      if (i === this.selectedIndex) row.classList.add('selected');

      const icon = document.createElement('span');
      icon.className = 'lf-spotlight-icon';
      icon.textContent = r.icon;

      const name = document.createElement('span');
      name.className = 'lf-spotlight-name';
      name.textContent = r.name;

      const badge = document.createElement('span');
      badge.className = 'lf-spotlight-badge';
      badge.textContent = r.type === 'app' ? 'Application' : 'File';

      row.append(icon, name, badge);

      row.addEventListener('click', () => {
        this.selectedIndex = i;
        this.activateSelected();
      });

      row.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.renderResults();
      });

      this.resultsList.appendChild(row);
    }
  }

  private activateSelected(): void {
    const r = this.results[this.selectedIndex];
    if (!r) return;

    this.hide();

    if (r.type === 'app' && r.appId) {
      this.onLaunchApp(r.appId);
    } else if (r.type === 'file' && r.path) {
      this.onOpenFile(r.path);
    }
  }
}
