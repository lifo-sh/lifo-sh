import type { WindowState, AppInstance } from '../types';

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const RESIZE_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;

export class DesktopWindow {
  readonly el: HTMLElement;
  readonly contentEl: HTMLElement;
  readonly state: WindowState;
  appInstance: AppInstance | null = null;

  private titleEl: HTMLElement;
  private dragState: { startX: number; startY: number; origX: number; origY: number } | null = null;
  private preMaxBounds: { x: number; y: number; width: number; height: number } | null = null;

  onFocus: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onMinimize: (() => void) | null = null;
  onMaximize: (() => void) | null = null;

  constructor(state: WindowState) {
    this.state = state;

    // Build DOM
    this.el = document.createElement('div');
    this.el.className = 'lf-window opening';
    this.el.style.cssText = `
      left: ${state.x}px; top: ${state.y}px;
      width: ${state.width}px; height: ${state.height}px;
      z-index: ${state.zIndex};
    `;

    // Titlebar
    const titlebar = document.createElement('div');
    titlebar.className = 'lf-window-titlebar';

    // Traffic lights
    const traffic = document.createElement('div');
    traffic.className = 'lf-window-traffic';

    const closeBtn = this.createTrafficBtn('close');
    const minBtn = this.createTrafficBtn('minimize');
    const maxBtn = this.createTrafficBtn('maximize');
    traffic.append(closeBtn, minBtn, maxBtn);

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onClose?.(); });
    minBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onMinimize?.(); });
    maxBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onMaximize?.(); });

    // Title
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'lf-window-title';
    this.titleEl.textContent = state.title;

    titlebar.append(traffic, this.titleEl);

    // Content
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'lf-window-content';

    this.el.append(titlebar, this.contentEl);

    // Resize handles
    for (const dir of RESIZE_DIRS) {
      const handle = document.createElement('div');
      handle.className = `lf-window-resize ${dir}`;
      handle.addEventListener('pointerdown', (e) => this.startResize(e, dir));
      this.el.appendChild(handle);
    }

    // Drag
    titlebar.addEventListener('pointerdown', (e) => this.startDrag(e));
    titlebar.addEventListener('dblclick', () => this.onMaximize?.());

    // Focus on click anywhere
    this.el.addEventListener('pointerdown', () => this.onFocus?.(), true);

    // Remove opening animation class after it plays
    this.el.addEventListener('animationend', () => {
      this.el.classList.remove('opening', 'closing', 'minimizing');
    }, { once: false });
  }

  setTitle(title: string): void {
    this.state.title = title;
    this.titleEl.textContent = title;
  }

  setFocused(focused: boolean): void {
    this.el.classList.toggle('focused', focused);
  }

  setZIndex(z: number): void {
    this.state.zIndex = z;
    this.el.style.zIndex = String(z);
  }

  minimize(): void {
    this.state.minimized = true;
    this.el.classList.add('minimizing');
    setTimeout(() => {
      this.el.classList.add('minimized');
      this.el.classList.remove('minimizing');
    }, 300);
  }

  restore(): void {
    this.state.minimized = false;
    this.el.classList.remove('minimized');
    this.el.classList.add('opening');
  }

  maximize(menubarHeight: number, dockHeight: number): void {
    if (this.state.maximized) {
      // Restore
      if (this.preMaxBounds) {
        this.state.x = this.preMaxBounds.x;
        this.state.y = this.preMaxBounds.y;
        this.state.width = this.preMaxBounds.width;
        this.state.height = this.preMaxBounds.height;
        this.preMaxBounds = null;
      }
      this.state.maximized = false;
      this.el.classList.remove('maximized');
    } else {
      // Save current bounds
      this.preMaxBounds = {
        x: this.state.x,
        y: this.state.y,
        width: this.state.width,
        height: this.state.height,
      };
      this.state.x = 0;
      this.state.y = menubarHeight;
      this.state.width = window.innerWidth;
      this.state.height = window.innerHeight - menubarHeight - dockHeight - 16;
      this.state.maximized = true;
      this.el.classList.add('maximized');
    }
    this.applyBounds();
  }

  animateClose(): Promise<void> {
    return new Promise((resolve) => {
      this.el.classList.add('closing');
      this.el.addEventListener('animationend', () => resolve(), { once: true });
    });
  }

  private applyBounds(): void {
    this.el.style.left = `${this.state.x}px`;
    this.el.style.top = `${this.state.y}px`;
    this.el.style.width = `${this.state.width}px`;
    this.el.style.height = `${this.state.height}px`;
  }

  private createTrafficBtn(type: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `lf-window-traffic-btn ${type}`;
    return btn;
  }

  private startDrag(e: PointerEvent): void {
    if (this.state.maximized) return;
    // Only drag from titlebar (not traffic light buttons)
    if ((e.target as HTMLElement).closest('.lf-window-traffic')) return;

    const titlebar = e.currentTarget as HTMLElement;
    titlebar.setPointerCapture(e.pointerId);
    this.dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origX: this.state.x,
      origY: this.state.y,
    };

    const onMove = (ev: PointerEvent) => {
      if (!this.dragState) return;
      this.state.x = this.dragState.origX + (ev.clientX - this.dragState.startX);
      this.state.y = this.dragState.origY + (ev.clientY - this.dragState.startY);
      this.applyBounds();
    };

    const onUp = () => {
      this.dragState = null;
      titlebar.removeEventListener('pointermove', onMove);
      titlebar.removeEventListener('pointerup', onUp);
    };

    titlebar.addEventListener('pointermove', onMove);
    titlebar.addEventListener('pointerup', onUp);
  }

  private startResize(e: PointerEvent, dir: string): void {
    if (this.state.maximized) return;
    e.stopPropagation();

    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = this.state.x;
    const origY = this.state.y;
    const origW = this.state.width;
    const origH = this.state.height;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newX = origX, newY = origY, newW = origW, newH = origH;

      if (dir.includes('e')) newW = Math.max(MIN_WIDTH, origW + dx);
      if (dir.includes('s')) newH = Math.max(MIN_HEIGHT, origH + dy);
      if (dir.includes('w')) {
        newW = Math.max(MIN_WIDTH, origW - dx);
        if (newW > MIN_WIDTH) newX = origX + dx;
      }
      if (dir.includes('n')) {
        newH = Math.max(MIN_HEIGHT, origH - dy);
        if (newH > MIN_HEIGHT) newY = origY + dy;
      }

      this.state.x = newX;
      this.state.y = newY;
      this.state.width = newW;
      this.state.height = newH;
      this.applyBounds();
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }
}
