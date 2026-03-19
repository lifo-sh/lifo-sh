/**
 * Worker script — executes commands using the kernel's VFS via SAB RPC.
 *
 * On startup, the worker receives a SharedArrayBuffer + wake MessagePort
 * from the main thread. It creates a VfsRpcClient that provides synchronous
 * IKernelVfs access backed by the main thread's real VFS — no snapshots,
 * no stale data.
 *
 * Sub-shell calls (e.g. child_process.exec within a node script) are
 * delegated back to the main thread via the shellExecute protocol.
 */

import {
	createMessagePortOutputStream,
	createMessagePortInputStream,
	type WorkerMessage,
	type StreamMessage,
} from './ContextSerialization.js';
import { WorkerKernel, VfsRpcClient } from '@lifo-sh/kernel';
import type { VirtualRequest, VirtualResponse } from '@lifo-sh/kernel';
import { createDefaultRegistry } from '../commands/registry.js';
import { createNodeImpl } from '../commands/system/node.js';
import type { CommandContext } from '../commands/types.js';
import { createNpmCommand, createNpxCommand } from '../';

/**
 * Port registry proxy — intercepts set/delete and notifies the main thread
 * so that ports registered by worker-side HTTP servers appear in the main
 * thread's portRegistry (visible to `ports`, `curl`, `tunnel`, etc.).
 *
 * For each registered port, a MessageChannel is created:
 *   - port2 is transferred to the main thread (requestPort)
 *   - port1 stays in the worker, listening for forwarded HTTP requests
 *
 * When the main thread's proxy handler receives a curl/tunnel request,
 * it forwards it to the worker via the requestPort. The worker calls the
 * real handler, waits for _donePromise, and sends the response back.
 */
class WorkerPortRegistry extends Map<number, any> {
	private requestPorts = new Map<number, MessagePort>();

	set(port: number, handler: any): this {
		super.set(port, handler);

		// Create channel for main thread to send HTTP requests to this handler
		const channel = new MessageChannel();
		this.requestPorts.set(port, channel.port1);

		// Listen for forwarded HTTP requests from the main thread
		channel.port1.onmessage = async (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type !== 'portRequest') return;

			const vReq: VirtualRequest = {
				method: msg.method,
				url: msg.url,
				headers: msg.headers,
				body: msg.body,
			};
			const vRes: VirtualResponse & { _donePromise?: Promise<void> } = {
				statusCode: 200,
				headers: {},
				body: '',
			};

			try {
				handler(vReq, vRes);

				// Wait for async handlers (Express, Vite, etc.) that set _donePromise
				if (vRes._donePromise) {
					await vRes._donePromise;
				}

				msg.responsePort.postMessage({
					type: 'portResponse',
					requestId: msg.requestId,
					statusCode: vRes.statusCode,
					headers: vRes.headers,
					body: vRes.body ?? '',
				});
			} catch (error) {
				msg.responsePort.postMessage({
					type: 'portResponse',
					requestId: msg.requestId,
					statusCode: 500,
					headers: { 'Content-Type': 'text/plain' },
					body: error instanceof Error ? error.message : String(error),
				});
			}
		};

		// Notify main thread about the new port
		console.log(`[Worker] Port ${port} registered, notifying main thread`);
		self.postMessage(
			{ type: 'portRegister', port, requestPort: channel.port2 } as WorkerMessage,
			[channel.port2],
		);

		return this;
	}

	delete(port: number): boolean {
		const existed = super.delete(port);
		if (existed) {
			const requestPort = this.requestPorts.get(port);
			if (requestPort) {
				requestPort.close();
				this.requestPorts.delete(port);
			}
			console.log(`[Worker] Port ${port} unregistered, notifying main thread`);
			self.postMessage({ type: 'portUnregister', port } as WorkerMessage);
		}
		return existed;
	}
}

// Global error handler — catches unhandled errors in the worker
self.onerror = (event) => {
	console.error('[Worker] Unhandled error:', event);
};
self.onunhandledrejection = (event) => {
	console.error('[Worker] Unhandled rejection:', event.reason);
};

const runningTasks = new Map<string, AbortController>();

// Pending shellExecute delegations to main thread
const pendingDelegations = new Map<string, {
	resolve: (exitCode: number) => void;
	reject: (error: Error) => void;
}>();

// Persistent state across command executions
let workerKernel: WorkerKernel | null = null;
const registry = createDefaultRegistry();

/**
 * Delegate a sub-shell command to the main thread.
 * Used by commands that need shell interpretation (e.g. child_process.exec).
 */
function shellExecuteOnMain(cmd: string, ctx: any): Promise<number> {
	const requestId = crypto.randomUUID();

	const stdoutChannel = new MessageChannel();
	const stderrChannel = new MessageChannel();

	// Bridge: forward data arriving from main thread to the caller's streams
	stdoutChannel.port1.onmessage = (e: MessageEvent<StreamMessage>) => {
		if (e.data.type === 'data') ctx.stdout?.write(e.data.data);
	};
	stderrChannel.port1.onmessage = (e: MessageEvent<StreamMessage>) => {
		if (e.data.type === 'data') ctx.stderr?.write(e.data.data);
	};

	return new Promise<number>((resolve, reject) => {
		pendingDelegations.set(requestId, { resolve, reject });

		const message: WorkerMessage = {
			type: 'shellExecute',
			requestId,
			cmd,
			ctx: { args: ctx.args ?? [], env: ctx.env ?? {}, cwd: ctx.cwd ?? '/' },
			ports: {
				stdout: stdoutChannel.port2,
				stderr: stderrChannel.port2,
			},
		};

		self.postMessage(message, {
			transfer: [stdoutChannel.port2, stderrChannel.port2],
		});
	});
}

self.onmessage = async (event: MessageEvent<WorkerMessage>): Promise<void> => {
	const msg = event.data;

	if (msg.type === 'init') {
		try {
			console.log('[Worker] Received init message, setting up VFS RPC...');
			// wakePort is transferred via postMessage transfer list —
			// access from msg.wakePort (structured clone), not event.ports
			const vfsClient = new VfsRpcClient(msg.sab, msg.wakePort);
			workerKernel = new WorkerKernel(vfsClient, new WorkerPortRegistry());
			workerKernel.setShellExecute(shellExecuteOnMain);

			// Register node command with the kernel
			registry.register('node', createNodeImpl(workerKernel));
			registry.register('npm', createNpmCommand(workerKernel as any, registry, shellExecuteOnMain));
			registry.register('npx', createNpxCommand(workerKernel as any, registry, shellExecuteOnMain));

			console.log('[Worker] VFS RPC initialized, commands registered');
			self.postMessage({ type: 'initialized' } as WorkerMessage);
		} catch (err) {
			console.error('[Worker] VFS RPC init failed:', err);
			self.postMessage({ type: 'error', id: 'init', error: String(err) } as WorkerMessage);
		}
		return;
	}

	if (msg.type === 'execute') {
		const { id, command, ctx, ports } = msg;
		const startTime = performance.now();
		console.log(`[Worker] Received execute: ${command} (id=${id.slice(0, 8)})`);

		try {
			const abortController = new AbortController();
			runningTasks.set(id, abortController);

			if (!workerKernel) {
				throw new Error('Worker not initialized — missing init message');
			}

			// Create stdio streams from the transferred ports
			const stdout = createMessagePortOutputStream(ports.stdout);
			const stderr = createMessagePortOutputStream(ports.stderr);
			const stdin = ports.stdin ? createMessagePortInputStream(ports.stdin) : undefined;

			// Create setRawMode callback that forwards to main thread via stdin port.
			// The main thread's bridgeStreamsToWorker already handles incoming
			// setRawMode messages and calls ctx.setRawMode on the terminal stdin.
			const setRawMode = ports.stdin
				? (enabled: boolean) => {
					ports.stdin!.postMessage({ type: 'setRawMode', enabled } as StreamMessage);
				}
				: undefined;

			// Resolve the command from the local registry
			const commandImpl = await registry.resolve(command);
			if (!commandImpl) {
				stderr.write(`${command}: command not found\n`);
				stdout.end();
				stderr.end();
				runningTasks.delete(id);
				self.postMessage({ type: 'result', id, exitCode: 127 } as WorkerMessage);
				return;
			}

			// Build the command context using WorkerKernel (VFS is live via RPC)
			const commandCtx: CommandContext = {
				kernel: workerKernel,
				args: ctx.args,
				env: ctx.env,
				cwd: ctx.cwd,
				vfs: workerKernel.vfs,
				stdout,
				stderr,
				stdin,
				setRawMode,
				signal: abortController.signal,
			};

			// Execute the command locally in the worker
			const exitCode = await commandImpl(commandCtx);

			stdout.end();
			stderr.end();
			runningTasks.delete(id);

			const duration = (performance.now() - startTime).toFixed(0);
			console.log(`[Worker] Executed: ${command} (${duration}ms, exit=${exitCode})`);

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
		const pending = pendingDelegations.get(msg.requestId);
		if (pending) {
			pendingDelegations.delete(msg.requestId);
			pending.resolve(msg.exitCode);
		}
	} else if (msg.type === 'shellExecuteError') {
		const pending = pendingDelegations.get(msg.requestId);
		if (pending) {
			pendingDelegations.delete(msg.requestId);
			pending.reject(new Error(msg.error));
		}
	}
};

// Signal ready to the main thread
self.postMessage({ type: 'ready' } as WorkerMessage);
