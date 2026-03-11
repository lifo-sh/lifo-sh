/**
 * Re-export context serialization from @lifo-sh/kernel.
 * Kept for backwards compatibility with command-worker.ts and other consumers.
 */
export {
	serializeContext,
	bridgeStreamsToWorker,
	createMessagePortOutputStream,
	createMessagePortInputStream,
	createStreamPort,
} from '@lifo-sh/kernel/runtime';

export type {
	SerializableContext,
	WorkerMessage,
	StreamMessage,
} from '@lifo-sh/kernel/runtime';
