import type { EventBus } from './EventBus';
import type { WindowManager } from './WindowManager';
import type { AppRegistry } from './AppRegistry';
import type { AppDefinition } from '../types';

interface DockItem {
  appId: string;
  el: HTMLElement;
  definition: AppDefinition;
  transient?: boolean; // true for non-pinned running apps
}

export class Dock {
  readonly el: HTMLElement;
  private dockBar: HTMLElement;
  private items: DockItem[] = [];
  private pinnedApps: string[] = [];
  private runningApps = new Set<string>(); // non-pinned apps shown in dock
  private runningSeparator: HTMLElement | null = null;
  private contextMenuEl: HTMLElement | null = null;
  private onLaunch: (appId: string) => void;

  constructor(
    container: HTMLElement,
    private eventBus: EventBus,
    private windowManager: WindowManager,
    private appRegistry: AppRegistry,
    onLaunch: (appId: string) => void,
  ) {
    this.onLaunch = onLaunch;

    const wrapper = document.createElement('div');
    wrapper.className = 'lf-dock-wrapper';

    this.dockBar = document.createElement('div');
    this.dockBar.className = 'lf-dock';

    wrapper.appendChild(this.dockBar);
    container.appendChild(wrapper);
    this.el = wrapper;

    // Update running indicators
    this.eventBus.on('window:open', () => this.updateRunning());
    this.eventBus.on('window:close', () => this.updateRunning());

    // Magnification
    this.dockBar.addEventListener('mousemove', (e) => this.handleMagnify(e));
    this.dockBar.addEventListener('mouseleave', () => this.clearMagnify());

    // Dismiss context menu on click elsewhere
    document.addEventListener('pointerdown', (e) => {
      if (this.contextMenuEl && !this.contextMenuEl.contains(e.target as Node)) {
        this.hideDockContextMenu();
      }
    });
  }

  addPinnedApp(definition: AppDefinition): void {
    this.pinnedApps.push(definition.id);
    this.addDockItem(definition);
  }

  addSeparator(): void {
    const sep = document.createElement('div');
    sep.className = 'lf-dock-separator';
    this.dockBar.appendChild(sep);
  }

  private addDockItem(definition: AppDefinition, transient = false): DockItem {
    const el = document.createElement('div');
    el.className = 'lf-dock-item';
    el.dataset.appId = definition.id;

    el.innerHTML = `
      <div class="lf-dock-tooltip">${definition.name}</div>
      <div class="lf-dock-icon">${definition.icon}</div>
      <div class="lf-dock-dot"></div>
    `;

    el.addEventListener('click', () => {
      // If there are existing windows, focus the first one
      const existing = this.windowManager.getWindowsByApp(definition.id);
      const visible = existing.filter((w) => !w.state.minimized);
      if (visible.length > 0) {
        this.windowManager.focusWindow(visible[0].state.id);
      } else if (existing.length > 0) {
        // Restore minimized
        this.windowManager.focusWindow(existing[0].state.id);
      } else {
        // Launch new
        this.bounce(el);
        this.onLaunch(definition.id);
      }
    });

    // Right-click context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showDockContextMenu(e.clientX, e.clientY, definition);
    });

    this.dockBar.appendChild(el);

    const item: DockItem = { appId: definition.id, el, definition, transient };
    this.items.push(item);
    return item;
  }

  private updateRunning(): void {
    // Update running dots for all items
    for (const item of this.items) {
      const windows = this.windowManager.getWindowsByApp(item.appId);
      item.el.classList.toggle('running', windows.length > 0);
    }

    // Detect non-pinned running apps
    const allWindows = this.windowManager.getAllWindows();
    const runningAppIds = new Set(allWindows.map((w) => w.state.appId));

    // Find apps that are running but not pinned
    const newTransient = new Set<string>();
    for (const appId of runningAppIds) {
      if (!this.pinnedApps.includes(appId)) {
        newTransient.add(appId);
      }
    }

    // Remove transient items for apps that are no longer running
    const toRemove = [...this.runningApps].filter((id) => !newTransient.has(id));
    for (const appId of toRemove) {
      const idx = this.items.findIndex((i) => i.appId === appId && i.transient);
      if (idx !== -1) {
        this.items[idx].el.remove();
        this.items.splice(idx, 1);
      }
      this.runningApps.delete(appId);
    }

    // Add new transient items
    const toAdd = [...newTransient].filter((id) => !this.runningApps.has(id));
    for (const appId of toAdd) {
      const def = this.appRegistry.get(appId);
      if (def) {
        // Ensure separator exists
        if (!this.runningSeparator && this.pinnedApps.length > 0) {
          this.runningSeparator = document.createElement('div');
          this.runningSeparator.className = 'lf-dock-separator';
          this.runningSeparator.dataset.runningSep = 'true';
          this.dockBar.appendChild(this.runningSeparator);
        }
        const item = this.addDockItem(def, true);
        item.el.classList.add('running');
        this.runningApps.add(appId);
      }
    }

    // Clean up separator if no transient items
    if (this.runningApps.size === 0 && this.runningSeparator) {
      this.runningSeparator.remove();
      this.runningSeparator = null;
    }
  }

  private showDockContextMenu(x: number, y: number, definition: AppDefinition): void {
    this.hideDockContextMenu();

    const menu = document.createElement('div');
    menu.className = 'lf-context-menu';

    const isPinned = this.pinnedApps.includes(definition.id);
    const windows = this.windowManager.getWindowsByApp(definition.id);
    const isRunning = windows.length > 0;

    if (isPinned && !isRunning) {
      // Pinned + not running → "Remove from Dock"
      this.appendMenuItem(menu, 'Remove from Dock', () => {
        this.removePinnedApp(definition.id);
      });
    }

    if (isRunning && !isPinned) {
      // Running + not pinned → "Keep in Dock"
      this.appendMenuItem(menu, 'Keep in Dock', () => {
        this.pinRunningApp(definition.id);
      });
    }

    if (isPinned && isRunning) {
      // Pinned + running → show "Remove from Dock"
      this.appendMenuItem(menu, 'Remove from Dock', () => {
        this.removePinnedApp(definition.id);
      });
    }

    if (isRunning) {
      // Separator before Quit
      const sep = document.createElement('div');
      sep.className = 'lf-context-menu-separator';
      menu.appendChild(sep);

      this.appendMenuItem(menu, 'Quit', () => {
        for (const w of windows) {
          this.windowManager.closeWindow(w.state.id);
        }
      });
    }

    // Position above dock
    menu.style.left = x + 'px';
    menu.style.bottom = 'auto';
    menu.style.top = '0px';
    document.body.appendChild(menu);

    // Measure and reposition above the dock
    const menuRect = menu.getBoundingClientRect();
    const dockRect = this.el.getBoundingClientRect();
    const top = dockRect.top - menuRect.height - 8;
    const left = Math.max(8, Math.min(x - menuRect.width / 2, window.innerWidth - menuRect.width - 8));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    this.contextMenuEl = menu;
  }

  private appendMenuItem(menu: HTMLElement, label: string, action: () => void): void {
    const item = document.createElement('div');
    item.className = 'lf-context-menu-item';
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideDockContextMenu();
      action();
    });
    menu.appendChild(item);
  }

  private hideDockContextMenu(): void {
    if (this.contextMenuEl) {
      this.contextMenuEl.remove();
      this.contextMenuEl = null;
    }
  }

  private removePinnedApp(appId: string): void {
    const idx = this.pinnedApps.indexOf(appId);
    if (idx === -1) return;
    this.pinnedApps.splice(idx, 1);

    const itemIdx = this.items.findIndex((i) => i.appId === appId && !i.transient);
    if (itemIdx !== -1) {
      this.items[itemIdx].el.remove();
      this.items.splice(itemIdx, 1);
    }
  }

  private pinRunningApp(appId: string): void {
    const def = this.appRegistry.get(appId);
    if (!def) return;

    // Remove from transient
    this.runningApps.delete(appId);
    const transientIdx = this.items.findIndex((i) => i.appId === appId && i.transient);
    if (transientIdx !== -1) {
      this.items[transientIdx].el.remove();
      this.items.splice(transientIdx, 1);
    }

    // Add as pinned (insert before separator / transient area)
    this.pinnedApps.push(appId);

    const el = document.createElement('div');
    el.className = 'lf-dock-item running';
    el.dataset.appId = def.id;

    el.innerHTML = `
      <div class="lf-dock-tooltip">${def.name}</div>
      <div class="lf-dock-icon">${def.icon}</div>
      <div class="lf-dock-dot"></div>
    `;

    el.addEventListener('click', () => {
      const existing = this.windowManager.getWindowsByApp(def.id);
      const visible = existing.filter((w) => !w.state.minimized);
      if (visible.length > 0) {
        this.windowManager.focusWindow(visible[0].state.id);
      } else if (existing.length > 0) {
        this.windowManager.focusWindow(existing[0].state.id);
      } else {
        this.bounce(el);
        this.onLaunch(def.id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showDockContextMenu(e.clientX, e.clientY, def);
    });

    // Insert before the running separator if it exists
    if (this.runningSeparator) {
      this.dockBar.insertBefore(el, this.runningSeparator);
    } else {
      this.dockBar.appendChild(el);
    }

    const item: DockItem = { appId: def.id, el, definition: def };
    // Insert before transient items in the array
    const firstTransientIdx = this.items.findIndex((i) => i.transient);
    if (firstTransientIdx !== -1) {
      this.items.splice(firstTransientIdx, 0, item);
    } else {
      this.items.push(item);
    }

    // Clean up separator if no more transient items
    if (this.runningApps.size === 0 && this.runningSeparator) {
      this.runningSeparator.remove();
      this.runningSeparator = null;
    }
  }

  private bounce(el: HTMLElement): void {
    el.classList.add('bouncing');
    setTimeout(() => el.classList.remove('bouncing'), 600);
  }

  private handleMagnify(e: MouseEvent): void {
    const items = this.dockBar.querySelectorAll('.lf-dock-item');
    const mouseX = e.clientX;

    items.forEach((item) => {
      const rect = (item as HTMLElement).getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(mouseX - center);

      (item as HTMLElement).classList.remove('near');
      (item as HTMLElement).style.transform = '';

      if (distance < 100 && distance > 40) {
        (item as HTMLElement).classList.add('near');
      }
    });
  }

  private clearMagnify(): void {
    const items = this.dockBar.querySelectorAll('.lf-dock-item');
    items.forEach((item) => {
      (item as HTMLElement).classList.remove('near');
      (item as HTMLElement).style.transform = '';
    });
  }
}
