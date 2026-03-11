/**
 * Process Executor — thin wrapper over @lifo-sh/kernel runtime.
 *
 * The executor classes (MainThreadExecutor, WorkerExecutor, RoutingExecutor)
 * live in the kernel. This module provides:
 * 1. Re-exports for backwards compatibility
 * 2. createProcessExecutor() factory that knows the worker URL
 */

import type { CommandRegistry } from '../commands/registry.js';
import { Kernel } from '@lifo-sh/kernel';
import {
	MainThreadExecutor,
	WorkerExecutor,
	RoutingExecutor,
} from '@lifo-sh/kernel/runtime';
import type { IProcessExecutor } from '@lifo-sh/kernel';

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
	return new RoutingExecutor(workerUrl, kernel, registry);
}
