/**
 * Process Executor — thin wrapper over @lifo-sh/kernel runtime.
 *
 * The executor classes (MainThreadExecutor, WorkerExecutor, RoutingExecutor)
 * live in the kernel. This module provides:
 * 1. Re-exports for backwards compatibility
 * 2. createProcessExecutor() factory that knows the worker URL
 * 3. ResilientRoutingExecutor — wraps RoutingExecutor with main-thread fallback
 */

import type { CommandRegistry } from '../commands/registry.js';
import { Kernel } from '@lifo-sh/kernel';
import {
	MainThreadExecutor,
	WorkerExecutor,
	RoutingExecutor,
} from '@lifo-sh/kernel/runtime';
import type { IProcessExecutor, ICommandContext } from '@lifo-sh/kernel';

// Re-export kernel types under the old names for compatibility
export type ProcessExecutor = IProcessExecutor;
export { MainThreadExecutor, WorkerExecutor, RoutingExecutor };

// Re-export context serialization from kernel
export {
	serializeContext,
	bridgeStreamsToWorker,
	createMessagePortOutputStream,
	createMessagePortInputStream,
} from '@lifo-sh/kernel/runtime';
export type { WorkerMessage, StreamMessage, SerializableContext } from '@lifo-sh/kernel/runtime';

/**
 * Wraps the RoutingExecutor with automatic main-thread fallback.
 *
 * If the worker fails to initialize or a worker command throws,
 * re-runs the command on the main thread so the user isn't stuck.
 */
class ResilientRoutingExecutor implements IProcessExecutor {
	private inner: RoutingExecutor;
	private mainFallback: MainThreadExecutor;
	private workerBroken = false;

	constructor(
		workerUrl: URL,
		kernel: Kernel,
		private registry: CommandRegistry,
	) {
		this.inner = new RoutingExecutor(workerUrl, kernel, registry);
		this.mainFallback = new MainThreadExecutor(registry);
	}

	setShellExecute(callback: (cmd: string, ctx: ICommandContext) => Promise<number>): void {
		this.inner.setShellExecute(callback);
	}

	async executeCommand(
		command: string,
		ctx: ICommandContext,
		abortController: AbortController,
	): Promise<number> {
		// If worker previously failed, skip straight to main thread
		if (this.workerBroken) {
			return this.mainFallback.executeCommand(command, ctx, abortController);
		}

		try {
			return await this.inner.executeCommand(command, ctx, abortController);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[ProcessExecutor] Worker failed for "${command}": ${msg}`);
			console.warn('[ProcessExecutor] Falling back to main thread execution');

			// Mark worker as broken so future commands skip it
			this.workerBroken = true;

			// Fall back to main thread
			return this.mainFallback.executeCommand(command, ctx, abortController);
		}
	}

	async terminate(): Promise<void> {
		await this.inner.terminate();
	}
}

/**
 * Factory that creates the right executor for the current environment.
 * This lives in core (not kernel) because it knows the worker URL —
 * the worker script is userspace code that sets up the command registry.
 */
export function createProcessExecutor(
	kernel: Kernel,
	registry: CommandRegistry,
): IProcessExecutor {
	if (!kernel.enableThreading) {
		console.log('⚠️ [ProcessExecutor] Worker threads DISABLED - all commands run on main thread');
		return new MainThreadExecutor(registry);
	}
	console.log('✅ [ProcessExecutor] Worker threads ENABLED - routing CPU-intensive commands to workers');
	const workerUrl = new URL('./command-worker.js', import.meta.url);
	return new ResilientRoutingExecutor(workerUrl, kernel, registry);
}
