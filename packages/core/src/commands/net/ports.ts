import type { Command } from '../types.js';
import type { Kernel } from '@lifo-sh/kernel';

/**
 * ports - List all ports in the portRegistry with details
 * Usage: ports
 */
export function createPortsCommand(kernel: Kernel): Command {
	return async (ctx) => {
		const ports = Array.from(kernel.portRegistry.entries()).sort((a, b) => a[0] - b[0]);

		if (ports.length === 0) {
			ctx.stdout.write('No active ports\n');
			return 0;
		}

		ctx.stdout.write('Registered ports in portRegistry:\n\n');
		ctx.stdout.write('Port   Handler   Description\n');
		ctx.stdout.write('-----  --------  -----------\n');

		for (const [port, handler] of ports) {
			const handlerStr = '\x1b[32m✓\x1b[0m    ';
			const handlerType = typeof handler;
			const desc = `Active (handler: ${handlerType})`;
			ctx.stdout.write(`${String(port).padEnd(6)} ${handlerStr}  ${desc}\n`);
		}

		ctx.stdout.write(`\nTotal: ${ports.length} port(s)\n`);
		ctx.stdout.write(`\nAccess: curl localhost:PORT or /api/proxy/PORT/ in browser\n`);
		return 0;
	};
}
