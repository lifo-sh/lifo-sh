import { DesktopWindow } from './Window';
import { EventBus } from './EventBus';
import type { AppInstance, WindowState } from '../types';

const MENUBAR_HEIGHT = 28;
const DOCK_HEIGHT = 78;
const CASCADE_OFFSET = 30;
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 480;

export class WindowManager {
  private windows = new Map<string, DesktopWindow>();
  private zCounter = 100;
  private cascadeIndex = 0;
  private focusedId: string | null = null;
  private layer: HTMLElement;

  constructor(private eventBus: EventBus, layer: HTMLElement) {
    this.layer = layer;
  }

  createWindow(appId: string, appInstance: AppInstance, opts?: Partial<WindowState>): DesktopWindow {
    const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Cascade position
    const x = opts?.x ?? 80 + (this.cascadeIndex % 10) * CASCADE_OFFSET;
    const y = opts?.y ?? MENUBAR_HEIGHT + 20 + (this.cascadeIndex % 10) * CASCADE_OFFSET;
    this.cascadeIndex++;

    const state: WindowState = {
      id,
      appId,
      title: opts?.title ?? appInstance.getTitle(),
      x,
      y,
      width: opts?.width ?? DEFAULT_WIDTH,
      height: opts?.height ?? DEFAULT_HEIGHT,
      minimized: false,
      maximized: false,
      zIndex: ++this.zCounter,
    };

    const win = new DesktopWindow(state);
    win.appInstance = appInstance;

    win.onFocus = () => this.focusWindow(id);
    win.onClose = () => this.closeWindow(id);
    win.onMinimize = () => this.minimizeWindow(id);
    win.onMaximize = () => this.maximizeWindow(id);

    this.windows.set(id, win);
    this.layer.appendChild(win.el);

    // Mount the app
    appInstance.mount(win.contentEl);

    // Focus it
    this.focusWindow(id);

    this.eventBus.emit('window:open', { windowId: id, appId });

    return win;
  }

  focusWindow(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;

    // If minimized, restore first
    if (win.state.minimized) {
      win.restore();
    }

    // Unfocus previous
    if (this.focusedId && this.focusedId !== id) {
      const prev = this.windows.get(this.focusedId);
      if (prev) prev.setFocused(false);
    }

    win.setZIndex(++this.zCounter);
    win.setFocused(true);
    win.appInstance?.focus?.();
    this.focusedId = id;

    this.eventBus.emit('window:focus', { windowId: id, appId: win.state.appId });
  }

  async closeWindow(id: string): Promise<void> {
    const win = this.windows.get(id);
    if (!win) return;

    await win.animateClose();
    win.appInstance?.unmount();
    win.el.remove();
    this.windows.delete(id);

    this.eventBus.emit('window:close', { windowId: id, appId: win.state.appId });

    // Focus next top window
    if (this.focusedId === id) {
      this.focusedId = null;
      const topWin = this.getTopWindow();
      if (topWin) this.focusWindow(topWin.state.id);
    }
  }

  minimizeWindow(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;

    win.minimize();
    this.eventBus.emit('window:minimize', { windowId: id });

    // Focus next window
    if (this.focusedId === id) {
      this.focusedId = null;
      const topWin = this.getTopWindow();
      if (topWin) this.focusWindow(topWin.state.id);
    }
  }

  maximizeWindow(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;
    win.maximize(MENUBAR_HEIGHT, DOCK_HEIGHT);
    this.eventBus.emit('window:maximize', { windowId: id });
  }

  getWindow(id: string): DesktopWindow | undefined {
    return this.windows.get(id);
  }

  getFocusedWindow(): DesktopWindow | undefined {
    return this.focusedId ? this.windows.get(this.focusedId) : undefined;
  }

  getWindowsByApp(appId: string): DesktopWindow[] {
    return [...this.windows.values()].filter((w) => w.state.appId === appId);
  }

  getAllWindows(): DesktopWindow[] {
    return [...this.windows.values()];
  }

  private getTopWindow(): DesktopWindow | undefined {
    let top: DesktopWindow | undefined;
    for (const win of this.windows.values()) {
      if (win.state.minimized) continue;
      if (!top || win.state.zIndex > top.state.zIndex) {
        top = win;
      }
    }
    return top;
  }
}
