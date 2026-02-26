import { EventEmitter } from './events.js';
import { Duplex } from './stream.js';
import type { VirtualRequestHandler } from '../kernel/index.js';

// ─── Socket ───

export class Socket extends Duplex {
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  localAddress = '127.0.0.1';
  localPort = 0;
  connecting = false;
  destroyed = false;
  readyState: 'opening' | 'open' | 'readOnly' | 'writeOnly' | 'closed' = 'closed';
  bytesRead = 0;
  bytesWritten = 0;
  timeout: number | null = null;

  private _connected = false;

  constructor(_options?: Record<string, unknown>) {
    super();
  }

  connect(portOrOptions: number | { port: number; host?: string }, hostOrCb?: string | (() => void), cb?: () => void): this {
    let port: number;
    let host: string;
    let callback: (() => void) | undefined;

    if (typeof portOrOptions === 'object') {
      port = portOrOptions.port;
      host = portOrOptions.host || '127.0.0.1';
      callback = typeof hostOrCb === 'function' ? hostOrCb : cb;
    } else {
      port = portOrOptions;
      host = typeof hostOrCb === 'string' ? hostOrCb : '127.0.0.1';
      callback = typeof hostOrCb === 'function' ? hostOrCb : cb;
    }

    this.connecting = true;
    this.remoteAddress = host;
    this.remotePort = port;

    queueMicrotask(() => {
      this.connecting = false;
      this._connected = true;
      this.readyState = 'open';
      if (callback) callback();
      this.emit('connect');
    });

    return this;
  }

  setTimeout(timeout: number, cb?: () => void): this {
    this.timeout = timeout;
    if (cb) this.on('timeout', cb);
    return this;
  }

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  address(): { port: number; family: string; address: string } {
    return { port: this.localPort, family: 'IPv4', address: this.localAddress };
  }

  override destroy(error?: Error): this {
    this.destroyed = true;
    this.readyState = 'closed';
    this._connected = false;
    if (error) this.emit('error', error);
    this.emit('close', !!error);
    return this;
  }

  ref(): this { return this; }
  unref(): this { return this; }
}

// ─── Server ───

export class Server extends EventEmitter {
  private _port: number | null = null;
  private _listening = false;
  private _portRegistry?: Map<number, VirtualRequestHandler>;
  private _connections = 0;
  maxConnections = 0;

  constructor(connectionListener?: (socket: Socket) => void) {
    super();
    if (connectionListener) {
      this.on('connection', connectionListener as (...args: unknown[]) => void);
    }
  }

  /** @internal */
  _setPortRegistry(registry: Map<number, VirtualRequestHandler>): void {
    this._portRegistry = registry;
  }

  listen(port: number, hostOrBacklogOrCb?: string | number | (() => void), backlogOrCb?: number | (() => void), cb?: () => void): this {
    let callback: (() => void) | undefined;

    if (typeof hostOrBacklogOrCb === 'function') {
      callback = hostOrBacklogOrCb;
    } else if (typeof backlogOrCb === 'function') {
      callback = backlogOrCb;
    } else {
      callback = cb;
    }

    this._port = port;
    this._listening = true;

    queueMicrotask(() => {
      if (callback) callback();
      this.emit('listening');
    });

    return this;
  }

  close(cb?: (err?: Error) => void): this {
    this._listening = false;

    if (this._port !== null && this._portRegistry) {
      this._portRegistry.delete(this._port);
    }

    queueMicrotask(() => {
      if (cb) cb();
      this.emit('close');
    });

    return this;
  }

  address(): { port: number; family: string; address: string } | null {
    if (this._port === null) return null;
    return { port: this._port, family: 'IPv4', address: '0.0.0.0' };
  }

  getConnections(cb: (err: Error | null, count: number) => void): void {
    cb(null, this._connections);
  }

  ref(): this { return this; }
  unref(): this { return this; }
}

// ─── Factory ───

export function createNet(portRegistry?: Map<number, VirtualRequestHandler>) {
  function createServer(optionsOrListener?: Record<string, unknown> | ((socket: Socket) => void), connectionListener?: (socket: Socket) => void): Server {
    const listener = typeof optionsOrListener === 'function' ? optionsOrListener : connectionListener;
    const server = new Server(listener);
    if (portRegistry) {
      server._setPortRegistry(portRegistry);
    }
    return server;
  }

  function createConnection(portOrOptions: number | { port: number; host?: string }, hostOrCb?: string | (() => void), cb?: () => void): Socket {
    const socket = new Socket();
    socket.connect(portOrOptions, hostOrCb, cb);
    return socket;
  }

  function connect(portOrOptions: number | { port: number; host?: string }, hostOrCb?: string | (() => void), cb?: () => void): Socket {
    return createConnection(portOrOptions, hostOrCb, cb);
  }

  function isIP(input: string): number {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(input)) return 4;
    if (input.includes(':')) return 6;
    return 0;
  }

  function isIPv4(input: string): boolean {
    return isIP(input) === 4;
  }

  function isIPv6(input: string): boolean {
    return isIP(input) === 6;
  }

  return {
    createServer,
    createConnection,
    connect,
    Socket,
    Server,
    isIP,
    isIPv4,
    isIPv6,
  };
}
