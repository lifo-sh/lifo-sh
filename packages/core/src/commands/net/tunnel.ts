import type { Command } from '../types.js';
import type { VirtualRequestHandler } from '../../kernel/index.js';
import { Buffer } from '../../node-compat/buffer.js';

interface TunnelOptions {
  server: string;
  verbose: boolean;
}

function parseArgs(args: string[]): TunnelOptions | { help: true } {
  let server = 'ws://localhost:3001';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      return { help: true };
    } else if (args[i].startsWith('--server=')) {
      server = args[i].slice('--server='.length);
    } else if (args[i] === '--server' && args[i + 1]) {
      server = args[++i];
    } else if (args[i] === '-v' || args[i] === '--verbose') {
      verbose = true;
    }
  }

  return { server, verbose };
}

function createTunnelImpl(portRegistry?: Map<number, VirtualRequestHandler>): Command {
  return async (ctx) => {
    const options = parseArgs(ctx.args);

    // Handle --help
    if ('help' in options && options.help) {
      ctx.stdout.write('Usage: tunnel [options]\n\n');
      ctx.stdout.write('Expose Lifo HTTP servers through a tunnel\n\n');
      ctx.stdout.write('Options:\n');
      ctx.stdout.write('  --server <url>    Tunnel server URL (default: ws://localhost:3001)\n');
      ctx.stdout.write('  -v, --verbose     Verbose logging\n');
      ctx.stdout.write('  -h, --help        Show this help\n\n');
      ctx.stdout.write('Example:\n');
      ctx.stdout.write('  tunnel --server=ws://tunnel.example.com:3001\n\n');
      ctx.stdout.write('Access tunneled servers using path-based routing:\n');
      ctx.stdout.write('  http://localhost:3001/8080/ → Port 8080 inside lifo\n');
      ctx.stdout.write('  http://localhost:3001/3000/api/users → Port 3000, path /api/users\n');
      return 0;
    }

    if (!portRegistry) {
      ctx.stderr.write('tunnel: portRegistry not available\n');
      return 1;
    }

    const { server, verbose } = options as TunnelOptions;

    // Get WebSocket constructor (browser native or Node.js ws package)
    let WebSocketConstructor: typeof WebSocket;

    // Check if we're in a browser environment with native WebSocket
    if (typeof globalThis.WebSocket !== 'undefined') {
      WebSocketConstructor = globalThis.WebSocket;
    } else {
      // Node.js environment - use ws package
      try {
        const wsModule = await import('ws');
        WebSocketConstructor = wsModule.WebSocket as unknown as typeof WebSocket;
      } catch (e) {
        ctx.stderr.write('tunnel: Failed to load WebSocket library\n');
        ctx.stderr.write('Make sure "ws" package is installed\n');
        return 1;
      }
    }

    let ws: WebSocket | null = null;
    let reconnecting = false;

    function log(message: string) {
      if (verbose) {
        ctx.stdout.write(`[tunnel] ${message}\n`);
      }
    }

    function logActivePorts() {
      const ports = Array.from(portRegistry!.keys()).sort((a, b) => a - b);

      if (ports.length === 0) {
        ctx.stdout.write('No active servers to tunnel\n');
        return;
      }

      ctx.stdout.write(`\nTunneling ${ports.length} server(s):\n`);
      for (const port of ports) {
        ctx.stdout.write(`  - Port ${port}: http://localhost:3001/${port}/\n`);
      }
      ctx.stdout.write('\n');
    }

    function sendError(requestId: string, statusCode: number, message: string) {
      if (!ws || ws.readyState !== WebSocketConstructor.OPEN) return;

      const response = {
        type: 'response',
        requestId,
        statusCode,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(message).toString('base64'),
      };

      ws.send(JSON.stringify(response));
    }

    function handleMessage(data: Buffer) {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'request') {
          const { requestId, method, url, headers, body } = message;

          log(`Received request: ${method} ${url}`);

          // Extract port from URL path: /8080/api/users → port=8080, path=/api/users
          const match = url.match(/^\/(\d+)(\/.*)?$/);

          if (!match) {
            sendError(requestId, 400, 'Invalid URL format. Use /PORT/path');
            return;
          }

          const port = parseInt(match[1], 10);
          const actualPath = match[2] || '/';

          // Lookup handler in portRegistry
          const handler = portRegistry!.get(port);

          if (!handler) {
            sendError(requestId, 404, `No server listening on port ${port}`);
            return;
          }

          // Create virtual request/response
          const vReq = {
            method,
            url: actualPath,
            headers,
            body: Buffer.from(body || '', 'base64').toString(),
          };

          const vRes = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            body: '',
          };

          try {
            // Call the virtual server handler (synchronous)
            handler(vReq, vRes);

            // Send response back through tunnel
            const response = {
              type: 'response',
              requestId,
              statusCode: vRes.statusCode,
              headers: vRes.headers,
              body: Buffer.from(vRes.body).toString('base64'),
            };

            ws?.send(JSON.stringify(response));
            log(`Sent response: ${vRes.statusCode}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            sendError(requestId, 500, `Internal server error: ${errorMessage}`);
          }
        }
      } catch (error) {
        ctx.stderr.write(`tunnel: Error processing message: ${error}\n`);
      }
    }

    function connect() {
      if (reconnecting || ctx.signal.aborted) return;

      ctx.stdout.write(`Connecting to tunnel server at ${server}...\n`);
      ws = new WebSocketConstructor(server);

      ws.addEventListener('open', () => {
        reconnecting = false;
        ctx.stdout.write(`Connected to tunnel server\n`);
        ctx.stdout.write(`Tunnel ready at ${server.replace('ws://', 'http://').replace('wss://', 'https://')}\n`);
        logActivePorts();
      });

      ws.addEventListener('message', (event) => {
        const data = typeof event.data === 'string'
          ? Buffer.from(event.data)
          : event.data;
        handleMessage(data);
      });

      ws.addEventListener('close', () => {
        if (!ctx.signal.aborted) {
          ctx.stdout.write('Disconnected from tunnel server\n');
          ctx.stdout.write('Reconnecting in 5 seconds...\n');
          reconnecting = true;
          setTimeout(() => {
            reconnecting = false;
            connect();
          }, 5000);
        }
      });

      ws.addEventListener('error', (event) => {
        const errorMessage = event instanceof ErrorEvent ? event.message : 'Connection error';
        ctx.stderr.write(`tunnel: WebSocket error: ${errorMessage}\n`);
      });
    }

    // Initial connection
    connect();

    // Wait for abort signal
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) {
        resolve();
        return;
      }

      ctx.signal.addEventListener(
        'abort',
        () => {
          ctx.stdout.write('\nShutting down tunnel...\n');
          ws?.close();
          resolve();
        },
        { once: true }
      );
    });

    return 0;
  };
}

export function createTunnelCommand(portRegistry: Map<number, VirtualRequestHandler>): Command {
  return createTunnelImpl(portRegistry);
}

// Default command (no port registry)
const command: Command = createTunnelImpl();

export default command;
