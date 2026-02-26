import { Socket } from './net.js';
import { EventEmitter } from './events.js';

// ─── TLSSocket ───

export class TLSSocket extends Socket {
  encrypted = true;
  authorized = true;
  authorizationError: string | null = null;

  constructor(socket?: Socket, _options?: Record<string, unknown>) {
    super();
    if (socket) {
      this.remoteAddress = socket.remoteAddress;
      this.remotePort = socket.remotePort;
    }
  }

  getPeerCertificate(_detailed?: boolean): Record<string, unknown> {
    return {};
  }

  getCipher(): { name: string; version: string; standardName: string } {
    return { name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3', standardName: 'TLS_AES_256_GCM_SHA384' };
  }

  getProtocol(): string {
    return 'TLSv1.3';
  }

  getEphemeralKeyInfo(): Record<string, unknown> {
    return { type: 'ECDH', name: 'X25519', size: 253 };
  }

  renegotiate(_options: Record<string, unknown>, cb?: (err: Error | null) => void): boolean {
    if (cb) queueMicrotask(() => cb(null));
    return true;
  }

  setMaxSendFragment(_size: number): boolean {
    return true;
  }
}

// ─── Server ───

export class Server extends EventEmitter {
  private _listening = false;

  constructor(_options?: Record<string, unknown>, _secureConnectionListener?: (socket: TLSSocket) => void) {
    super();
    if (_secureConnectionListener) {
      this.on('secureConnection', _secureConnectionListener as (...args: unknown[]) => void);
    }
  }

  listen(port: number, hostOrCb?: string | (() => void), cb?: () => void): this {
    const callback = typeof hostOrCb === 'function' ? hostOrCb : cb;
    this._listening = true;

    queueMicrotask(() => {
      if (callback) callback();
      this.emit('listening');
    });

    return this;
  }

  close(cb?: () => void): this {
    this._listening = false;
    queueMicrotask(() => {
      if (cb) cb();
      this.emit('close');
    });
    return this;
  }

  address(): { port: number; family: string; address: string } | null {
    return null;
  }
}

// ─── Factory functions ───

export function createServer(_options?: Record<string, unknown>, _secureConnectionListener?: (socket: TLSSocket) => void): Server {
  return new Server(_options, _secureConnectionListener);
}

export function connect(options: { host?: string; port: number; servername?: string }, cb?: () => void): TLSSocket {
  const socket = new TLSSocket();
  socket.connect({ port: options.port, host: options.host || '127.0.0.1' });
  if (cb) socket.on('secureConnect', cb);

  queueMicrotask(() => {
    socket.emit('secureConnect');
  });

  return socket;
}

export const DEFAULT_ECDH_CURVE = 'auto';
export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';

export function createSecureContext(_options?: Record<string, unknown>): Record<string, unknown> {
  return {};
}

export default {
  TLSSocket,
  Server,
  createServer,
  connect,
  createSecureContext,
  DEFAULT_ECDH_CURVE,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
};
