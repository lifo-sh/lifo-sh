import { EventEmitter } from './events.js';

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

  constructor(options: RequestOptions, cb?: (res: IncomingMessage) => void) {
    super();
    this.options = options;
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

    const proto = 'http';
    const host = this.options.hostname || this.options.host || 'localhost';
    const port = this.options.port ? `:${this.options.port}` : '';
    const path = this.options.path || '/';
    const url = `${proto}://${host}${port}${path}`;

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

export function request(urlOrOptions: string | RequestOptions, optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void): ClientRequest {
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

  return new ClientRequest(options, callback);
}

export function get(urlOrOptions: string | RequestOptions, optionsOrCb?: RequestOptions | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void): ClientRequest {
  const req = request(urlOrOptions, optionsOrCb, cb);
  req.end();
  return req;
}

export function createServer(): never {
  throw new Error('http.createServer() is not supported in BrowserOS');
}

export default { request, get, createServer, IncomingMessage, ClientRequest };
