import type { EventBus } from './EventBus';
import type { WindowManager } from './WindowManager';
import type { AppDefinition } from '../types';

interface DockItem {
  appId: string;
  el: HTMLElement;
  definition: AppDefinition;
}

export class Dock {
  readonly el: HTMLElement;
  private dockBar: HTMLElement;
  private items: DockItem[] = [];
  private pinnedApps: string[] = [];
  private onLaunch: (appId: string) => void;

  constructor(
    container: HTMLElement,
    private eventBus: EventBus,
    private windowManager: WindowManager,
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

  private addDockItem(definition: AppDefinition): DockItem {
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

    this.dockBar.appendChild(el);

    const item: DockItem = { appId: definition.id, el, definition };
    this.items.push(item);
    return item;
  }

  private updateRunning(): void {
    for (const item of this.items) {
      const windows = this.windowManager.getWindowsByApp(item.appId);
      item.el.classList.toggle('running', windows.length > 0);
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
