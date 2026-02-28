import type { Packet } from '../types.js';
import type { NetworkStack } from '../NetworkStack.js';
import { BaseTunnel } from './BaseTunnel.js';
import { Buffer } from '../../../node-compat/buffer.js';

/**
 * WebSocket Tunnel - Bridge virtual network to external WebSocket server
 *
 * This tunnel connects Lifo's virtual network stack to an external WebSocket
 * tunnel server, enabling host machine access to virtual servers.
 *
 * Example:
 *   tunnel --server=ws://localhost:3001
 *
 * Access from host:
 *   http://localhost:3001/3000/ → Port 3000 in virtual network
 */
export class WebSocketTunnel extends BaseTunnel {
  type: 'ssh' = 'ssh'; // Using 'ssh' type for compatibility

  private wsUrl: string;
  private ws: WebSocket | null = null;
  private portRegistry?: Map<number, any>;
  private reconnectTimer?: any;
  private isReconnecting = false;

  // Packet queue
  private packetQueue: Packet[] = [];
  private waitingResolvers: Array<(packet: Packet) => void> = [];

  constructor(
    id: string,
    wsUrl: string,
    networkStack: NetworkStack,
    portRegistry?: Map<number, any>,
    namespace = 'default'
  ) {
    super(id, networkStack, namespace, 1400); // WebSocket overhead

    this.wsUrl = wsUrl;
    this.portRegistry = portRegistry;

    this.config = {
      mode: 'websocket',
      server: wsUrl,
      ports: portRegistry ? Array.from(portRegistry.keys()) : [],
    };
  }

  protected getTunnelPrefix(): string {
    return 'wst';
  }

  /**
   * Bring tunnel up - connect to WebSocket server
   */
  override async up(): Promise<void> {
    if (this.state === 'up') {
      return;
    }

    await this.connect();
    this.state = 'up';
    this.interface.up();
  }

  /**
   * Bring tunnel down - disconnect from WebSocket server
   */
  override async down(): Promise<void> {
    if (this.state === 'down') {
      return;
    }

    this.isReconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state = 'down';
    this.interface.down();
  }

  /**
   * Send packet through WebSocket tunnel
   */
  async send(packet: Packet): Promise<void> {
    if (this.state === 'down' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket tunnel is not connected');
    }

    try {
      // Serialize packet
      const data = this.serializePacket(packet);

      // Send through WebSocket
      this.ws.send(data);

      // Update stats
      this.updateStats(data.byteLength, 'tx');
    } catch (error) {
      this.updateStats(0, 'tx', true);
      throw error;
    }
  }

  /**
   * Receive packet from WebSocket tunnel
   */
  async recv(): Promise<Packet> {
    if (this.state === 'down') {
      throw new Error('WebSocket tunnel is down');
    }

    if (this.packetQueue.length > 0) {
      return this.packetQueue.shift()!;
    }

    return new Promise((resolve) => {
      this.waitingResolvers.push(resolve);
    });
  }

  /**
   * Connect to WebSocket server
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Get WebSocket constructor
        let WebSocketConstructor: typeof WebSocket;

        if (typeof globalThis.WebSocket !== 'undefined') {
          WebSocketConstructor = globalThis.WebSocket;
        } else {
          // Node.js - would need to import ws package
          reject(new Error('WebSocket not available'));
          return;
        }

        this.ws = new WebSocketConstructor(this.wsUrl);

        this.ws.addEventListener('open', () => {
          this.isReconnecting = false;
          resolve();
        });

        this.ws.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });

        this.ws.addEventListener('close', () => {
          if (this.state === 'up' && !this.isReconnecting) {
            this.scheduleReconnect();
          }
        });

        this.ws.addEventListener('error', (error) => {
          console.error('WebSocket tunnel error:', error);
          if (this.state === 'down') {
            reject(error);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.reconnectTimer = setTimeout(async () => {
      if (this.state === 'up') {
        try {
          await this.connect();
        } catch (error) {
          this.scheduleReconnect();
        }
      }
    }, 5000);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: any): void {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'request') {
        // Handle HTTP request from tunnel server
        this.handleHttpRequest(message);
      } else if (message.type === 'response') {
        // Handle response (if we're acting as client)
        this.handleHttpResponse(message);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }

  /**
   * Handle HTTP request from tunnel server
   */
  private handleHttpRequest(message: any): void {
    const { requestId, method, url, headers, body } = message;

    // Extract port from URL: /3000/path -> port=3000, path=/path
    const match = url.match(/^\/(\d+)(\/.*)?$/);

    if (!match) {
      this.sendError(requestId, 400, 'Invalid URL format. Use /PORT/path');
      return;
    }

    const port = parseInt(match[1], 10);
    const path = match[2] || '/';

    // Check if port exists in registry
    if (!this.portRegistry || !this.portRegistry.has(port)) {
      this.sendError(requestId, 404, `No server listening on port ${port}`);
      return;
    }

    // Get handler
    const handler = this.portRegistry.get(port);

    // Create virtual request/response
    const vReq = {
      method,
      url: path,
      headers,
      body: Buffer.from(body || '', 'base64').toString(),
    };

    const vRes = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: '',
    };

    try {
      // Call handler synchronously
      handler(vReq, vRes);

      // Send response back through WebSocket
      this.sendResponse(requestId, vRes.statusCode, vRes.headers, vRes.body);

      // Update stats
      this.updateStats(vRes.body.length, 'tx');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendError(requestId, 500, `Internal server error: ${errorMessage}`);
    }
  }

  /**
   * Handle HTTP response (for client-side requests)
   */
  private handleHttpResponse(_message: any): void {
    // For future client-side request support
    // Not needed for current server-only implementation
  }

  /**
   * Send HTTP response through WebSocket
   */
  private sendResponse(requestId: string, statusCode: number, headers: Record<string, string>, body: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const response = {
      type: 'response',
      requestId,
      statusCode,
      headers,
      body: Buffer.from(body).toString('base64'),
    };

    this.ws.send(JSON.stringify(response));
  }

  /**
   * Send error response through WebSocket
   */
  private sendError(requestId: string, statusCode: number, message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const response = {
      type: 'response',
      requestId,
      statusCode,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from(message).toString('base64'),
    };

    this.ws.send(JSON.stringify(response));
  }

  /**
   * Serialize packet to bytes
   */
  private serializePacket(packet: Packet): ArrayBuffer {
    const header = new Uint8Array(9);
    const view = new DataView(header.buffer);

    view.setUint16(0, packet.source.port);
    view.setUint16(2, packet.destination.port);
    view.setUint8(4, packet.protocol === 'tcp' ? 6 : 17);
    view.setUint32(5, packet.data.length);

    const combined = new Uint8Array(header.length + packet.data.length);
    combined.set(header);
    combined.set(packet.data, header.length);

    return combined.buffer;
  }

  /**
   * Get tunnel status string
   */
  override toString(): string {
    const base = super.toString();
    const server = this.wsUrl;
    const connected = this.ws && this.ws.readyState === WebSocket.OPEN ? '✓' : '✗';
    const ports = this.portRegistry ? Array.from(this.portRegistry.keys()).join(',') : 'none';
    return `${base} ${server} [${connected}] ports=${ports}`;
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get active ports
   */
  getActivePorts(): number[] {
    return this.portRegistry ? Array.from(this.portRegistry.keys()).sort((a, b) => a - b) : [];
  }
}
