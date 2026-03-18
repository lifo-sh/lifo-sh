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
import { createDefaultRegistry } from '../commands/registry.js';
import { createNodeImpl } from '../commands/system/node.js';
import type { CommandContext } from '../commands/types.js';
import { createNpmCommand, createNpxCommand } from '../';

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
			workerKernel = new WorkerKernel(vfsClient, new Map());
			workerKernel.setShellExecute(shellExecuteOnMain);

			// Register node command with the kernel
			registry.register('node', createNodeImpl(workerKernel));
			registry.register('npm', createNpmCommand(workerKernel));
			registry.register('npx', createNpxCommand(workerKernel));

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
