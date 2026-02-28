import type { Command } from '../types.js';
import type { Kernel } from '../../kernel/index.js';
import { WebSocketTunnel } from '../../kernel/network/tunnel/WebSocketTunnel.js';

/**
 * tunnel - WebSocket-based tunnel for host machine access
 *
 * Creates a WebSocket tunnel that connects the virtual network to an external
 * tunnel server, enabling host machine access to virtual HTTP servers.
 *
 * Usage:
 *   tunnel [--server=ws://localhost:3005] [-v]
 *
 * Access from host:
 *   http://localhost:3005/3000/ → Port 3000 inside Lifo
 */

interface TunnelOptions {
	server: string;
	verbose: boolean;
}

function parseArgs(args: string[]): TunnelOptions | { help: true } {
	let server = 'ws://localhost:3005';
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

export function createTunnelCommandV2(kernel: Kernel): Command {
	return async (ctx) => {
		const options = parseArgs(ctx.args);

		// Handle --help
		if ('help' in options && options.help) {
			ctx.stdout.write(`Usage: tunnel [options]

Expose Lifo HTTP servers through a WebSocket tunnel

Options:
  --server <url>    Tunnel server URL (default: ws://localhost:3005)
  -v, --verbose     Verbose logging
  -h, --help        Show this help

Example:
  # Start tunnel server (in separate terminal):
  node apps/tunnel-server.js

  # In Lifo terminal:
  node server.js &
  tunnel

  # Access from host machine:
  curl http://localhost:3005/3000/
  open http://localhost:3005/3000/

Access tunneled servers using path-based routing:
  http://localhost:3005/3000/         → Port 3000 inside Lifo
  http://localhost:3005/8080/api      → Port 8080, path /api
  http://localhost:3005/3000/users    → Port 3000, path /users\n`);
			return 0;
		}

		const { server, verbose } = options as TunnelOptions;

		function log(message: string) {
			if (verbose) {
				ctx.stdout.write(`[tunnel] ${message}\n`);
			}
		}

		// Check if tunnel already exists
		const existingTunnel = kernel.networkStack.getTunnel('wst0');
		if (existingTunnel) {
			ctx.stderr.write('Tunnel already active. Use Ctrl+C to stop it first.\n');
			return 1;
		}

		// Create WebSocket tunnel
		const tunnelId = kernel.networkStack.getNextTunnelId();
		const tunnel = new WebSocketTunnel(
			tunnelId,
			server,
			kernel.networkStack,
			kernel.portRegistry,
			'default'
		);

		ctx.stdout.write(`Connecting to tunnel server at ${server}...\n`);
		log('Creating WebSocket tunnel');

		try {
			// Add tunnel to network stack
			kernel.networkStack.addTunnel('wst0', tunnel);

			// Bring tunnel up (connects WebSocket)
			await tunnel.up();

			ctx.stdout.write(`✓ Connected to tunnel server\n`);
			ctx.stdout.write(`Tunnel ready at ${server.replace('ws://', 'http://').replace('wss://', 'https://')}\n`);

			// Show active ports
			const ports = tunnel.getActivePorts();
			if (ports.length === 0) {
				ctx.stdout.write('\nNo active servers to tunnel\n');
				ctx.stdout.write('Start a server first: node server.js\n');
			} else {
				ctx.stdout.write(`\nTunneling ${ports.length} server(s):\n`);
				for (const port of ports) {
					const httpUrl = server.replace('ws://', 'http://').replace('wss://', 'https://').replace(/:\d+$/, ':3005');
					ctx.stdout.write(`  - Port ${port}: ${httpUrl}/${port}/\n`);
				}
			}

			ctx.stdout.write('\nPress Ctrl+C to stop tunnel\n\n');

			log('Tunnel is active');

			// Monitor connection status
			const checkInterval = setInterval(() => {
				if (!tunnel.isConnected()) {
					log('Connection lost, reconnecting...');
				} else {
					log('Connection active');
				}
			}, verbose ? 10000 : 60000);

			// Wait for abort signal
			await new Promise<void>((resolve) => {
				if (ctx.signal.aborted) {
					resolve();
					return;
				}

				ctx.signal.addEventListener(
					'abort',
					() => {
						clearInterval(checkInterval);
						resolve();
					},
					{ once: true }
				);
			});

			// Cleanup
			ctx.stdout.write('\nShutting down tunnel...\n');
			await tunnel.down();
			await kernel.networkStack.removeTunnel('wst0');
			ctx.stdout.write('Tunnel closed\n');

			return 0;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			ctx.stderr.write(`tunnel: ${msg}\n`);

			// Cleanup on error
			try {
				await tunnel.down();
				await kernel.networkStack.removeTunnel('wst0');
			} catch {
				// Ignore cleanup errors
			}

			return 1;
		}
	};
}
