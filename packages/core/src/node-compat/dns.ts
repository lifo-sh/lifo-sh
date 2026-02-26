// ─── DNS module shim ───
// In browser environment, DNS resolution is handled by the browser/OS.
// This shim provides stub implementations that return localhost values.

type LookupCallback = (err: Error | null, address: string, family: number) => void;
type ResolveCallback = (err: Error | null, addresses: string[]) => void;

export function lookup(hostname: string, optionsOrCb?: Record<string, unknown> | LookupCallback, cb?: LookupCallback): void {
  const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;

  queueMicrotask(() => {
    if (!callback) return;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      callback(null, '127.0.0.1', 4);
    } else if (hostname === '::1') {
      callback(null, '::1', 6);
    } else {
      // Return the hostname itself as if it resolved
      // In browser, actual DNS is handled by fetch/XMLHttpRequest
      callback(null, hostname, 4);
    }
  });
}

export function resolve(hostname: string, rrTypeOrCb?: string | ResolveCallback, cb?: ResolveCallback): void {
  const callback = typeof rrTypeOrCb === 'function' ? rrTypeOrCb : cb;

  queueMicrotask(() => {
    if (!callback) return;
    callback(null, [hostname]);
  });
}

export function resolve4(hostname: string, cb: ResolveCallback): void {
  queueMicrotask(() => cb(null, [hostname]));
}

export function resolve6(hostname: string, cb: ResolveCallback): void {
  queueMicrotask(() => cb(null, [hostname]));
}

export function resolveMx(hostname: string, cb: (err: Error | null, addresses: Array<{ exchange: string; priority: number }>) => void): void {
  queueMicrotask(() => cb(null, [{ exchange: hostname, priority: 10 }]));
}

export function resolveTxt(hostname: string, cb: (err: Error | null, addresses: string[][]) => void): void {
  queueMicrotask(() => cb(null, []));
}

export function resolveSrv(hostname: string, cb: (err: Error | null, addresses: Array<{ name: string; port: number; priority: number; weight: number }>) => void): void {
  queueMicrotask(() => cb(null, []));
}

export function resolveCname(hostname: string, cb: ResolveCallback): void {
  queueMicrotask(() => cb(null, [hostname]));
}

export function resolveNs(hostname: string, cb: ResolveCallback): void {
  queueMicrotask(() => cb(null, []));
}

export function reverse(ip: string, cb: ResolveCallback): void {
  queueMicrotask(() => cb(null, [ip]));
}

export function setServers(_servers: string[]): void {
  // No-op in browser
}

export function getServers(): string[] {
  return ['127.0.0.1'];
}

// ─── Promises API ───

export const promises = {
  lookup: async (hostname: string, _options?: Record<string, unknown>): Promise<{ address: string; family: number }> => {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return { address: '127.0.0.1', family: 4 };
    }
    return { address: hostname, family: 4 };
  },
  resolve: async (hostname: string, _rrType?: string): Promise<string[]> => {
    return [hostname];
  },
  resolve4: async (hostname: string): Promise<string[]> => {
    return [hostname];
  },
  resolve6: async (hostname: string): Promise<string[]> => {
    return [hostname];
  },
};

export default {
  lookup,
  resolve,
  resolve4,
  resolve6,
  resolveMx,
  resolveTxt,
  resolveSrv,
  resolveCname,
  resolveNs,
  reverse,
  setServers,
  getServers,
  promises,
};
