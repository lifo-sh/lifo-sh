/**
 * Worker script for executing commands in a dedicated thread.
 * Initializes its own VFS and command registry, then handles
 * 'execute' and 'abort' messages from the main thread.
 */

console.log("hello world")
import { VFS } from '@lifo-sh/kernel';
import { createDefaultRegistry, type CommandRegistry } from '../commands/registry.js';
import { PersistenceManager, IndexedDBPersistenceBackend } from '@lifo-sh/kernel/persistence';
import {
	createMessagePortOutputStream,
	createMessagePortInputStream,
	serializeContext,
	type WorkerMessage,
} from './ContextSerialization.js';
import type { CommandContext } from '../commands/types.js';
import { createNpmCommand, createNpxCommand, type ShellExecuteFn } from '../commands/system/npm.js';

let vfs: VFS | null = null;
let registry: CommandRegistry | null = null;
let currentDbName: string | null = null;
let persistence: PersistenceManager | null = null;

// Port registry port - MessagePort for communicating with main thread's port registry
let portRegistryPort: MessagePort | null = null;
const localPortHandlers = new Map<number, any>();
const portRequestChannels = new Map<number, MessagePort>();

// Simple port registry that forwards to main thread via MessagePort
const proxyPortRegistry = new Map();
proxyPortRegistry.set = function(port: number, handler: any) {
	console.log(`🔌 [Worker] Registering port ${port} with main thread`);

	// Store handler locally
	localPortHandlers.set(port, handler);

	if (portRegistryPort) {
		// Create a channel for this specific port's requests
		const channel = new MessageChannel();
		portRequestChannels.set(port, channel.port1);

		// Listen for HTTP requests on this port
		channel.port1.onmessage = async (e: MessageEvent) => {
			const { requestId, method, url, headers, body } = e.data;
			console.log(`🌐 [Worker] HTTP request for port ${port}: ${method} ${url}`);

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
				console.error(`❌ [Worker] Error handling port ${port}:`, error);
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
	console.log(`🔌 [Worker] Unregistering port ${port}`);

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
		console.log(`📞 [Worker] shellExecute request: ${cmd}`);

		return new Promise<number>((resolve, reject) => {
			pendingShellExecute.set(requestId, { resolve, reject });

			// Serialize context for main thread
			const { serializable, ports, localPorts } = serializeContext(ctx, currentDbName!);

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

async function initVFS(dbName: string): Promise<void> {
	const isFirstInit = !vfs || currentDbName !== dbName;

	if (isFirstInit) {
		console.log(`🔧 [Worker] Initializing VFS with database: ${dbName}`);
		currentDbName = dbName;
		vfs = new VFS();
		registry = createDefaultRegistry();

		// Register npm/npx with shellExecute proxy and fakeKernel so bin scripts
		// (e.g. vite) installed by npm use proxyPortRegistry instead of the isolated
		// module-level defaultPortRegistry. proxyPortRegistry forwards port
		// registrations to the main thread's kernel.portRegistry, making worker-hosted
		// servers visible to curl and netstat.
		const shellExecute = createShellExecuteProxy();
		const fakeKernel = { portRegistry: proxyPortRegistry } as any;
		registry.register('npm', createNpmCommand(registry, shellExecute, fakeKernel));
		registry.register('npx', createNpxCommand(registry, shellExecute));
		console.log('✅ [Worker] Registered npm/npx with shellExecute proxy and proxyPortRegistry');

		// Override node command to use proxyPortRegistry and shellExecute proxy
		// This allows HTTP servers in worker to be accessible from main thread
		// and enables child_process.spawn()/fork() via shellExecute fallback
		const { createNodeImpl } = await import('../commands/system/node.js');
		registry.register('node', createNodeImpl(proxyPortRegistry as any, shellExecute as any));
		console.log('✅ [Worker] Registered node command with proxyPortRegistry and shellExecute');

		persistence = new PersistenceManager(new IndexedDBPersistenceBackend(dbName));
		await persistence.open();

		// Set up VFS watch to auto-save changes (same as main thread)
		vfs.watch(() => {
			if (persistence) {
				persistence.scheduleSave(vfs!.getRoot());
				console.log('💾 [Worker] VFS change detected, scheduling save...');
			}
		});
	}

	// Always reload VFS from IndexedDB to pick up main-thread changes
	const saved = await persistence!.load();
	if (saved) vfs!.loadFromSerialized(saved);

	if (isFirstInit) {
		console.log('✅ [Worker] VFS and command registry initialized with persistence');
	}
}

self.onmessage = async (event: MessageEvent<WorkerMessage>): Promise<void> => {
	const msg = event.data;

	if (msg.type === 'execute') {
		const { id, command, ctx, ports } = msg;
		console.log(`🚀 [Worker] Received command: ${command}`);
		const startTime = performance.now();

		try {
			// Set port registry port if provided (it's the last port in event.ports after stdout/stderr/stdin)
			if ((ctx as any).portRegistryPort && !portRegistryPort && event.ports) {
				// The portRegistryPort is the last one in the transfer array
				const portIndex = ports.stdin ? 3 : 2; // After stdout, stderr, (stdin?)
				if (event.ports.length > portIndex) {
					portRegistryPort = event.ports[portIndex];
					console.log('✅ [Worker] Port registry communication channel established via network interface');
				}
			}

			await initVFS(ctx.vfsDbName);

			const abortController = new AbortController();
			runningTasks.set(id, abortController);

			const stdout = createMessagePortOutputStream(ports.stdout);
			const stderr = createMessagePortOutputStream(ports.stderr);

			const commandCtx: CommandContext = {
				args: ctx.args,
				env: ctx.env,
				cwd: ctx.cwd,
				vfs: vfs!,
				stdout,
				stderr,
				stdin: ports.stdin ? createMessagePortInputStream(ports.stdin) : undefined,
				signal: abortController.signal,
			};

			const commandImpl = await registry!.resolve(command);
			if (!commandImpl) throw new Error(`Command not found: ${command}`);

			console.log(`⚙️ [Worker] Executing: ${command}`);
			const exitCode = await commandImpl(commandCtx);
			runningTasks.delete(id);

			// Explicitly save VFS changes to IndexedDB after command execution
			if (persistence && vfs) {
				await persistence.save(vfs.getRoot());
				console.log(`💾 [Worker] VFS changes saved to IndexedDB after ${command}`);
			}

			stdout.end();
			stderr.end();

			const duration = (performance.now() - startTime).toFixed(0);
			console.log(`✅ [Worker] Completed: ${command} (${duration}ms, exit=${exitCode})`);

			self.postMessage({ type: 'result', id, exitCode } as WorkerMessage);
		} catch (error) {
			runningTasks.delete(id);
			const duration = (performance.now() - startTime).toFixed(0);
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`❌ [Worker] Failed: ${command} (${duration}ms) - ${errorMsg}`);
			self.postMessage({
				type: 'error',
				id,
				error: errorMsg,
			} as WorkerMessage);
		}
	} else if (msg.type === 'abort') {
		console.log(`⚠️ [Worker] Aborting task: ${msg.id}`);
		runningTasks.get(msg.id)?.abort();
		runningTasks.delete(msg.id);
	} else if (msg.type === 'shellExecuteResult') {
		console.log(`✅ [Worker] shellExecute completed: exit=${msg.exitCode}`);
		const pending = pendingShellExecute.get(msg.requestId);
		if (pending) {
			pendingShellExecute.delete(msg.requestId);
			pending.resolve(msg.exitCode);
		}
	} else if (msg.type === 'shellExecuteError') {
		console.error(`❌ [Worker] shellExecute failed: ${msg.error}`);
		const pending = pendingShellExecute.get(msg.requestId);
		if (pending) {
			pendingShellExecute.delete(msg.requestId);
			pending.reject(new Error(msg.error));
		}
	}
};

// Signal ready to the main thread
console.log('🌐 [Worker] Worker thread started, signaling ready to main thread');
self.postMessage({ type: 'ready' } as WorkerMessage);
