export const _setTimeout = globalThis.setTimeout;
export const _setInterval = globalThis.setInterval;
export const _clearTimeout = globalThis.clearTimeout;
export const _clearInterval = globalThis.clearInterval;

export function setImmediate(fn: (...args: unknown[]) => void, ...args: unknown[]): ReturnType<typeof setTimeout> {
  return _setTimeout(() => fn(...args), 0);
}

export function clearImmediate(id: ReturnType<typeof setTimeout>): void {
  _clearTimeout(id);
}

export default {
  setTimeout: _setTimeout,
  setInterval: _setInterval,
  clearTimeout: _clearTimeout,
  clearInterval: _clearInterval,
  setImmediate,
  clearImmediate,
};
