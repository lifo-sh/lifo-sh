/**
 * Worker script for executing commands in a dedicated thread.
 *
 * Instead of creating its own VFS instance, the worker receives a VFS
 * snapshot from the kernel at command start and uses a WorkerVfsProxy
 * that forwards writes back to the kernel via MessagePort.
 */

import { WorkerKernel } from '@lifo-sh/kernel';
import { createDefaultRegistry, type CommandRegistry } from '../commands/registry.js';
import {
	createMessagePortOutputStream,
	createMessagePortInputStream,
	serializeContext,
	type WorkerMessage,
} from './ContextSerialization.js';
import type { CommandContext } from '../commands/types.js';
import { createNpmCommand, createNpxCommand, type ShellExecuteFn } from '../commands/system/npm.js';

let workerKernel: WorkerKernel | null = null;
let registry: CommandRegistry | null = null;

// Port registry port - MessagePort for communicating with main thread's port registry
let portRegistryPort: MessagePort | null = null;
const localPortHandlers = new Map<number, any>();
const portRequestChannels = new Map<number, MessagePort>();

// Simple port registry that forwards to main thread via MessagePort
const proxyPortRegistry = new Map();
proxyPortRegistry.set = function(port: number, handler: any) {
	console.log(`[Worker] Registering port ${port} with main thread`);

	// Store handler locally
	localPortHandlers.set(port, handler);

	if (portRegistryPort) {
		// Create a channel for this specific port's requests
		const channel = new MessageChannel();
		portRequestChannels.set(port, channel.port1);

		// Listen for HTTP requests on this port
		channel.port1.onmessage = async (e: MessageEvent) => {
			const { requestId, method, url, headers, body } = e.data;

			const vReq = { method, url, headers, body };
			const vRes = { statusCode: 200, headers: {}, body: '' };

			try {
				handler(vReq, vRes);

				// Wait for async response if needed
				if ((vRes as any)._donePromise) {
					await (vRes as any)._donePromise;
				}

				portRegistryPort!.postMessage({
					type: 'portResponse',
					requestId,
					statusCode: vRes.statusCode,
					headers: vRes.headers,
					body: vRes.body
				});
			} catch (error) {
				portRegistryPort!.postMessage({
					type: 'portResponse',
					requestId,
					statusCode: 500,
					headers: {},
					body: String(error)
				});
			}
		};

		// Notify main thread to register this port
		portRegistryPort.postMessage({
			type: 'portRegister',
			port,
			requestPort: channel.port2
		}, [channel.port2]);
	}

	return proxyPortRegistry;
};

proxyPortRegistry.delete = function(port: number) {
	localPortHandlers.delete(port);

	const channel = portRequestChannels.get(port);
	if (channel) {
		channel.close();
		portRequestChannels.delete(port);
	}

	if (portRegistryPort) {
		portRegistryPort.postMessage({ type: 'portUnregister', port });
	}

	return true;
};

const runningTasks = new Map<string, AbortController>();

// Map to track pending shellExecute requests
const pendingShellExecute = new Map<string, {
	resolve: (exitCode: number) => void;
	reject: (error: Error) => void;
}>();

/**
 * Create a shellExecute proxy that sends requests to the main thread
 */
function createShellExecuteProxy(): ShellExecuteFn {
	return async (cmd: string, ctx: CommandContext): Promise<number> => {
		const requestId = crypto.randomUUID();

		return new Promise<number>((resolve, reject) => {
			pendingShellExecute.set(requestId, { resolve, reject });

			// Serialize context for main thread
			const { serializable, ports, localPorts } = serializeContext(ctx);

			// Bridge: forward data arriving from main thread back to original ctx streams
			localPorts.stdout.onmessage = (event: MessageEvent) => {
				const msg = event.data;
				if (msg.type === 'data') {
					ctx.stdout.write(msg.data);
				}
			};
			localPorts.stderr.onmessage = (event: MessageEvent) => {
				const msg = event.data;
				if (msg.type === 'data') {
					ctx.stderr.write(msg.data);
				}
			};

			const message: WorkerMessage = {
				type: 'shellExecute',
				requestId,
				cmd,
				ctx: serializable,
				ports,
			};

			const transfer: Transferable[] = [ports.stdout, ports.stderr];
			if (ports.stdin) transfer.push(ports.stdin);

			self.postMessage(message, { transfer });
		});
	};
}

function initRegistry(): void {
	if (registry) return;

	registry = createDefaultRegistry();

	// Register npm/npx with shellExecute proxy and workerKernel
	const shellExecute = createShellExecuteProxy();
	registry.register('npm', createNpmCommand(registry, shellExecute, workerKernel as any));
	registry.register('npx', createNpxCommand(registry, shellExecute));

	// Override node command to use workerKernel's portRegistry and shellExecute proxy
	import('../commands/system/node.js').then(({ createNodeImpl }) => {
		registry!.register('node', createNodeImpl(proxyPortRegistry as any, shellExecute as any));
	});
}

self.onmessage = async (event: MessageEvent<WorkerMessage>): Promise<void> => {
	const msg = event.data;

	if (msg.type === 'execute') {
		const { id, command, ctx, ports, vfsSnapshot } = msg;
		const startTime = performance.now();

		try {
			// Set port registry port if provided
			if ((ctx as any).portRegistryPort && !portRegistryPort && event.ports) {
				const portIndex = ports.stdin ? 3 : 2; // After stdout, stderr, (stdin?), vfsPort
				// VFS port is at index portIndex, portRegistry is after that
				if ((ctx as any).hasVfsPort) {
					if (event.ports.length > portIndex + 1) {
						portRegistryPort = event.ports[portIndex + 1];
					}
				} else if (event.ports.length > portIndex) {
					portRegistryPort = event.ports[portIndex];
				}
			}

			// Get the VFS MessagePort from transferred ports
			let vfsPortIndex = ports.stdin ? 3 : 2;
			const vfsPort = (ctx as any).hasVfsPort ? event.ports[vfsPortIndex] : null;

			// Create or update WorkerKernel
			if (vfsPort && vfsSnapshot) {
				if (workerKernel) {
					workerKernel.reset(vfsPort, vfsSnapshot);
				} else {
					workerKernel = new WorkerKernel(vfsPort, vfsSnapshot, proxyPortRegistry);
				}
			} else if (workerKernel && vfsSnapshot) {
				workerKernel.loadSnapshot(vfsSnapshot);
			} else if (!workerKernel) {
				throw new Error('No VFS channel or snapshot provided');
			}

			// Initialize registry (once, after workerKernel is created)
			initRegistry();

			const abortController = new AbortController();
			runningTasks.set(id, abortController);

			const stdout = createMessagePortOutputStream(ports.stdout);
			const stderr = createMessagePortOutputStream(ports.stderr);

			const commandCtx: CommandContext = {
				kernel: workerKernel,
				args: ctx.args,
				env: ctx.env,
				cwd: ctx.cwd,
				vfs: workerKernel.vfs,
				stdout,
				stderr,
				stdin: ports.stdin ? createMessagePortInputStream(ports.stdin) : undefined,
				signal: abortController.signal,
			};

			const commandImpl = await registry!.resolve(command);
			if (!commandImpl) throw new Error(`Command not found: ${command}`);

			const exitCode = await commandImpl(commandCtx);
			runningTasks.delete(id);

			stdout.end();
			stderr.end();

			const duration = (performance.now() - startTime).toFixed(0);
			console.log(`[Worker] Completed: ${command} (${duration}ms, exit=${exitCode})`);

			self.postMessage({ type: 'result', id, exitCode } as WorkerMessage);
		} catch (error) {
			runningTasks.delete(id);
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`[Worker] Failed: ${command} - ${errorMsg}`);
			self.postMessage({
				type: 'error',
				id,
				error: errorMsg,
			} as WorkerMessage);
		}
	} else if (msg.type === 'abort') {
		runningTasks.get(msg.id)?.abort();
		runningTasks.delete(msg.id);
	} else if (msg.type === 'shellExecuteResult') {
		const pending = pendingShellExecute.get(msg.requestId);
		if (pending) {
			pendingShellExecute.delete(msg.requestId);
			pending.resolve(msg.exitCode);
		}
	} else if (msg.type === 'shellExecuteError') {
		const pending = pendingShellExecute.get(msg.requestId);
		if (pending) {
			pendingShellExecute.delete(msg.requestId);
			pending.reject(new Error(msg.error));
		}
	}
};

// Signal ready to the main thread
self.postMessage({ type: 'ready' } as WorkerMessage);
