import type { Kernel } from '@lifo-sh/core';
import type { EventBus } from './core/EventBus';
import type { WindowManager } from './core/WindowManager';
import type { AppRegistry } from './core/AppRegistry';

// ─── App Context ───

export interface AppContext {
  kernel: Kernel;
  eventBus: EventBus;
  windowManager: WindowManager;
  appRegistry: AppRegistry;
}

// ─── App Definition ───

export interface AppDefinition {
  id: string;
  name: string;
  icon: string; // emoji or SVG
  /** File extensions this app can open (e.g. ['.txt', '.md']) */
  extensions?: string[];
  /** Menu items when this app is focused */
  menus?: MenuCategory[];
  createInstance(ctx: AppContext, filePath?: string): AppInstance;
}

// ─── App Instance ───

export interface AppInstance {
  readonly appId: string;
  mount(container: HTMLElement): void;
  unmount(): void;
  focus?(): void;
  getTitle(): string;
  getMenus?(): MenuCategory[];
}

// ─── Menu ───

export interface MenuCategory {
  label: string;
  items: MenuItem[];
}

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

// ─── Window State ───

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
}
