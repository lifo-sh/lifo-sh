import { EventEmitter } from './events.js';
import type { VirtualRequestHandler } from '../kernel/index.js';

interface RequestOptions {
  hostname?: string;
  host?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

class IncomingMessage extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  method?: string;
  url?: string;

  constructor(statusCode: number, statusMessage: string, headers: Record<string, string>) {
    super();
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
    this.headers = headers;
  }

  setEncoding(_enc: string): this {
    return this;
  }
}

class ClientRequest extends EventEmitter {
  private options: RequestOptions;
  private body = '';
  private aborted = false;
  private portRegistry?: Map<number, VirtualRequestHandler>;

  constructor(options: RequestOptions, cb?: (res: IncomingMessage) => void, portRegistry?: Map<number, VirtualRequestHandler>) {
    super();
    this.options = options;
    this.portRegistry = portRegistry;
    if (cb) this.on('response', cb as (...args: unknown[]) => void);

    // Defer the actual fetch
    queueMicrotask(() => this.execute());
  }

  write(data: string): void {
    this.body += data;
  }

  end(data?: string): void {
    if (data) this.body += data;
  }

  abort(): void {
    this.aborted = true;
  }

  private async execute(): Promise<void> {
    if (this.aborted) return;

    const host = this.options.hostname || this.options.host || 'localhost';
    const port = this.options.port ? Number(this.options.port) : undefined;
    const path = this.options.path || '/';

    // Check if target is a virtual server
    if (this.portRegistry && port && (host === 'localhost' || host === '127.0.0.1')) {
      const handler = this.portRegistry.get(port);
      if (handler) {
        const vReq = {
          method: this.options.method || 'GET',
          url: path,
          headers: this.options.headers || {},
          body: this.body,
        };
        const vRes = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          body: '',
        };

        try {
          handler(vReq, vRes);

          const msg = new IncomingMessage(vRes.statusCode, 'OK', vRes.headers);
          this.emit('response', msg);

          queueMicrotask(() => {
            msg.emit('data', vRes.body);
            msg.emit('end');
          });
        } catch (e) {
          this.emit('error', e);
        }
        return;
      }
    }

    // Fall through to real fetch
    const proto = 'http';
    const portStr = this.options.port ? `:${this.options.port}` : '';
    const url = `${proto}://${host}${portStr}${path}`;

    try {
      const resp = await fetch(url, {
        method: this.options.method || 'GET',
        headers: this.options.headers,
        body: this.options.method !== 'GET' && this.body ? this.body : undefined,
      });

      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });

      const msg = new IncomingMessage(resp.status, resp.statusText, headers);
      this.emit('response', msg);

      const text = await resp.text();
      msg.emit('data', text);
      msg.emit('end');
    } catch (e) {
      this.emit('error', e);
    }
  }

  setTimeout(_ms: number, cb?: () => void): this {
    if (cb) this.on('timeout', cb);
    return this;
  }
}

// --- ServerResponse class ---

class ServerResponse {
  statusCode = 200;
  private _headers: Record<string, string> = {};
  private _body = '';
  private _vRes: { statusCode: number; headers: Record<string, string>; body: string };

  constructor(vRes: { statusCode: number; headers: Record<string, string>; body: string }) {
    this._vRes = vRes;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      Object.assign(this._headers, headers);
    }
    return this;
  }

  setHeader(name: string, value: string): this {
    this._headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string): string | undefined {
    return this._headers[name.toLowerCase()];
  }

  write(data: string): boolean {
    this._body += data;
    return true;
  }

  end(data?: string): void {
    if (data) this._body += data;
    // Flush to virtual response
    this._vRes.statusCode = this.statusCode;
    this._vRes.headers = { ...this._headers };
    this._vRes.body = this._body;
  }
}

// --- Server class ---

// Symbol used to track active server promises on the http module instance
export const ACTIVE_SERVERS = Symbol.for('lifo.http.activeServers');

class Server extends EventEmitter {
  private portRegistry: Map<number, VirtualRequestHandler>;
  private _port: number | null = null;
  private _closeResolve: (() => void) | null = null;
  private _promise: Promise<void> | null = null;
  private _activeServers: Server[];

  constructor(
    portRegistry: Map<number, VirtualRequestHandler>,
    activeServers: Server[],
    requestHandler?: (req: unknown, res: unknown) => void,
  ) {
    super();
    this.portRegistry = portRegistry;
    this._activeServers = activeServers;
    if (requestHandler) {
      this.on('request', requestHandler as (...args: unknown[]) => void);
    }
  }

  listen(port: number, ...rest: unknown[]): this {
    let callback: (() => void) | undefined;
    for (const arg of rest) {
      if (typeof arg === 'function') {
        callback = arg as () => void;
        break;
      }
    }

    this._port = port;

    // Create a promise that resolves when server.close() is called
    this._promise = new Promise<void>((resolve) => {
      this._closeResolve = resolve;
    });

    // Register the handler in portRegistry
    const handler: VirtualRequestHandler = (vReq, vRes) => {
      const req = new IncomingMessage(0, '', vReq.headers);
      req.method = vReq.method;
      req.url = vReq.url;

      const res = new ServerResponse(vRes);
      this.emit('request', req, res);
    };
    this.portRegistry.set(port, handler);

    // Track this server
    this._activeServers.push(this);

    if (callback) {
      // Call callback asynchronously like Node does
      queueMicrotask(callback);
    }

    return this;
  }

  close(callback?: () => void): this {
    if (this._port !== null) {
      this.portRegistry.delete(this._port);
    }

    // Remove from active servers list
    const idx = this._activeServers.indexOf(this);
    if (idx !== -1) this._activeServers.splice(idx, 1);

    if (this._closeResolve) {
      this._closeResolve();
      this._closeResolve = null;
    }

    if (callback) {
      queueMicrotask(callback);
    }

    this.emit('close');
    return this;
  }

  address(): { port: number; address: string; family: string } | null {
    if (this._port === null) return null;
    return { port: this._port, address: '127.0.0.1', family: 'IPv4' };
  }

  getPromise(): Promise<void> | null {
    return this._promise;
  }
}

// --- Factory function ---

export function createHttp(portRegistry?: Map<number, VirtualRequestHandler>) {
  // Track active servers created by this http module instance
  const activeServers: Server[] = [];

  function httpRequest(
    urlOrOptions: string | RequestOptions,
    optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void,
  ): ClientRequest {
    let options: RequestOptions;
    let callback: ((res: IncomingMessage) => void) | undefined;

    if (typeof urlOrOptions === 'string') {
      const u = new URL(urlOrOptions);
      options = {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
      };
      if (typeof optionsOrCb === 'function') {
        callback = optionsOrCb;
      } else {
        options = { ...options, ...optionsOrCb };
        callback = cb;
      }
    } else {
      options = urlOrOptions;
      callback = optionsOrCb as ((res: IncomingMessage) => void) | undefined;
    }

    return new ClientRequest(options, callback, portRegistry);
  }

  function httpGet(
    urlOrOptions: string | RequestOptions,
    optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void,
  ): ClientRequest {
    const req = httpRequest(urlOrOptions, optionsOrCb, cb);
    req.end();
    return req;
  }

  function httpCreateServer(requestHandler?: (req: unknown, res: unknown) => void): Server {
    if (!portRegistry) {
      throw new Error('http.createServer() is not supported in Lifo');
    }
    return new Server(portRegistry, activeServers, requestHandler);
  }

  const mod = {
    request: httpRequest,
    get: httpGet,
    createServer: httpCreateServer,
    IncomingMessage,
    ClientRequest,
    Server,
    ServerResponse,
    [ACTIVE_SERVERS]: activeServers,
  };

  return mod;
}

// --- Legacy static exports (for backward compatibility) ---

export function request(urlOrOptions: string | RequestOptions, optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void): ClientRequest {
  return createHttp().request(urlOrOptions, optionsOrCb, cb);
}

export function get(urlOrOptions: string | RequestOptions, optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void): ClientRequest {
  return createHttp().get(urlOrOptions, optionsOrCb, cb);
}

export function createServer(): never {
  throw new Error('http.createServer() is not supported in Lifo');
}

export default { request, get, createServer, IncomingMessage, ClientRequest };
