export interface DesktopEvents {
  'window:open': { windowId: string; appId: string };
  'window:close': { windowId: string; appId: string };
  'window:focus': { windowId: string; appId: string };
  'window:minimize': { windowId: string };
  'window:maximize': { windowId: string };
  'app:launch': { appId: string };
  'file:open': { path: string };
  'menu:update': {};
}

type EventHandler<T = unknown> = (data: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<K extends keyof DesktopEvents>(event: K, handler: EventHandler<DesktopEvents[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as EventHandler);
    return () => set.delete(handler as EventHandler);
  }

  emit<K extends keyof DesktopEvents>(event: K, data: DesktopEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(data);
      }
    }
  }

  off<K extends keyof DesktopEvents>(event: K, handler: EventHandler<DesktopEvents[K]>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as EventHandler);
    }
  }
}
