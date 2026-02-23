export class EventEmitter {
  private _events = new Map<string, Array<(...args: unknown[]) => void>>();
  private _maxListeners = 10;

  on(event: string, listener: (...args: unknown[]) => void): this {
    let list = this._events.get(event);
    if (!list) {
      list = [];
      this._events.set(event, list);
    }
    list.push(listener);
    return this;
  }

  addListener(event: string, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener);
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };
    (wrapped as { _original?: (...args: unknown[]) => void })._original = listener;
    return this.on(event, wrapped);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this._events.get(event);
    if (!list || list.length === 0) return false;
    const copy = [...list];
    for (const fn of copy) {
      fn.apply(this, args);
    }
    return true;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const list = this._events.get(event);
    if (!list) return this;
    const idx = list.findIndex(
      (fn) => fn === listener || (fn as { _original?: unknown })._original === listener,
    );
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this._events.delete(event);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event !== undefined) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  listenerCount(event: string): number {
    return this._events.get(event)?.length ?? 0;
  }

  listeners(event: string): Array<(...args: unknown[]) => void> {
    return [...(this._events.get(event) ?? [])];
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }

  eventNames(): string[] {
    return [...this._events.keys()];
  }

  prependListener(event: string, listener: (...args: unknown[]) => void): this {
    let list = this._events.get(event);
    if (!list) {
      list = [];
      this._events.set(event, list);
    }
    list.unshift(listener);
    return this;
  }
}

export default EventEmitter;
