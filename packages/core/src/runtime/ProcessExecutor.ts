import type { CommandContext, CommandOutputStream } from '../commands/types.js';
import type { CommandRegistry } from '../commands/registry.js';
import {
	serializeContext,
	bridgeStreamsToWorker,
	type WorkerMessage,
} from './ContextSerialization.js';

export interface ProcessExecutor {
	executeCommand(command: string, ctx: CommandContext, abortController: AbortController): Promise<number>;
	terminate(): Promise<void>;
}

/**
 * Runs commands directly on the main thread.
 */
export class MainThreadExecutor implements ProcessExecutor {
	constructor(private registry: CommandRegistry) { }

	async executeCommand(command: string, ctx: CommandContext): Promise<number> {
		const commandImpl = await this.registry.resolve(command);
		if (!commandImpl) {
			ctx.stderr.write(`Command not found: ${command}\n`);
			return 127;
		}
		return commandImpl(ctx);
	}

	async terminate(): Promise<void> { }
}

/**
 * Runs commands in a single persistent Web Worker.
 * The worker initializes its own VFS and command registry.
 */
export class WorkerExecutor implements ProcessExecutor {
	private worker: Worker | null = null;
	private pendingTasks = new Map<string, {
		resolve: (code: number) => void;
		reject: (err: Error) => void;
	}>();
	private portRegistryChannel: MessagePort | null = null;
	private portRequestChannels = new Map<number, MessagePort>();
	private pendingPortRequests = new Map<string, {
		resolve: (response: { statusCode: number; headers: Record<string, string>; body: string }) => void;
		reject: (err: Error) => void;
	}>();

	private portRegistryPort2: MessagePort | null = null;
	private portRegistrySent = false;

	constructor(
		private vfsDbName: string,
		private onShellExecute?: (cmd: string, ctx: CommandContext) => Promise<number>,
		private onVfsReload?: () => Promise<void>,
		private portRegistry?: Map<number, any>
	) {
		// Create port registry communication channel
		if (portRegistry) {
			const channel = new MessageChannel();
			this.portRegistryChannel = channel.port1;
			this.portRegistryPort2 = channel.port2;

			// Listen for port registry messages from worker
			this.portRegistryChannel.onmessage = (e: MessageEvent) => {
				this.handlePortRegistryMessage(e.data, e.ports);
			};
		}
	}

	/**
	 * Update the shellExecute callback after construction.
	 * Called by Shell after it's initialized.
	 */
	setShellExecute(callback: (cmd: string, ctx: CommandContext) => Promise<number>): void {
		this.onShellExecute = callback;
		console.log('✅ [WorkerExecutor] shellExecute callback registered');
	}

	private async ensureWorker(): Promise<Worker> {
		if (this.worker) return this.worker;

		// Create a fresh MessageChannel for the new worker instance.
		// The previous port2 was transferred (and lost) with the old worker.
		if (this.portRegistry) {
			this.portRegistryChannel?.close();
			const channel = new MessageChannel();
			this.portRegistryChannel = channel.port1;
			this.portRegistryPort2 = channel.port2;
			this.portRegistrySent = false;
			this.portRegistryChannel.onmessage = (e: MessageEvent) => {
				this.handlePortRegistryMessage(e.data, e.ports);
			};
		}

		console.log('🔧 [WorkerExecutor] Initializing Web Worker...');
		const worker = new Worker(new URL('./command-worker.js', import.meta.url), { type: 'module' });

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10_000);

			worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
				if (e.data.type === 'ready') {
					clearTimeout(timeout);
					console.log('✅ [WorkerExecutor] Worker initialized and ready!');
					worker.onmessage = (ev) => this.handleMessage(ev.data);
					resolve();
				}
			};

			worker.onerror = (e) => {
				clearTimeout(timeout);
				console.error('❌ [WorkerExecutor] Worker initialization failed:', e.message);
				reject(new Error(e.message));
			};
		});

		this.worker = worker;
		return worker;
	}

	async executeCommand(
		command: string,
		ctx: CommandContext,
		abortController: AbortController,
	): Promise<number> {
		const worker = await this.ensureWorker();
		const id = crypto.randomUUID();

		console.log(`📤 [WorkerExecutor] Sending command to worker: ${command}`);
		const startTime = performance.now();

		const { serializable, ports, localPorts } = serializeContext(ctx, this.vfsDbName);
		bridgeStreamsToWorker(ctx, localPorts, abortController.signal);

		return new Promise<number>((resolve, reject) => {
			this.pendingTasks.set(id, {
				resolve: async (code: number) => {
					const duration = (performance.now() - startTime).toFixed(0);
					console.log(`✅ [WorkerExecutor] Command completed in worker: ${command} (${duration}ms, exit=${code})`);

					// Reload VFS from IndexedDB to sync worker changes
					if (this.onVfsReload) {
						console.log('🔄 [WorkerExecutor] Reloading VFS from IndexedDB to sync worker changes...');
						await this.onVfsReload();
						console.log('✅ [WorkerExecutor] VFS reloaded successfully');
					}

					resolve(code);
				},
				reject: (err: Error) => {
					const duration = (performance.now() - startTime).toFixed(0);
					console.error(`❌ [WorkerExecutor] Command failed in worker: ${command} (${duration}ms) - ${err.message}`);
					reject(err);
				}
			});

			abortController.signal.addEventListener('abort', () => {
				console.log(`⚠️ [WorkerExecutor] Aborting command in worker: ${command}`);
				worker.postMessage({ type: 'abort', id } as WorkerMessage);
			});

			// Prepare transfer array
			const transfer: Transferable[] = [ports.stdout, ports.stderr];
			if (ports.stdin) transfer.push(ports.stdin);

			// Add port registry port on first execution
			const extendedCtx: any = { ...serializable };
			if (this.portRegistryPort2 && !this.portRegistrySent) {
				extendedCtx.portRegistryPort = true; // Flag that port is being sent
				transfer.push(this.portRegistryPort2);
				this.portRegistrySent = true;
				console.log('🔌 [WorkerExecutor] Sending port registry communication channel to worker');
			}

			const message: WorkerMessage = { type: 'execute', id, command, ctx: extendedCtx, ports };
			worker.postMessage(message, transfer);
		});
	}

	private handleMessage(data: WorkerMessage): void {
		if (data.type === 'result') {
			const task = this.pendingTasks.get(data.id);
			if (task) { this.pendingTasks.delete(data.id); task.resolve(data.exitCode); }
		} else if (data.type === 'error') {
			const task = this.pendingTasks.get(data.id);
			if (task) { this.pendingTasks.delete(data.id); task.reject(new Error(data.error)); }
		} else if (data.type === 'shellExecute') {
			// Handle shellExecute request from worker
			this.handleShellExecuteRequest(data);
		} else if (data.type === 'portRegister') {
			// Handle port registration from worker
			this.handlePortRegister(data);
		} else if (data.type === 'portUnregister') {
			// Handle port unregistration from worker
			this.handlePortUnregister(data);
		} else if (data.type === 'portResponse') {
			// Handle HTTP response from worker
			this.handlePortResponse(data);
		}
	}

	private handlePortRegister(msg: WorkerMessage & { type: 'portRegister' }): void {
		const { port, requestPort } = msg;
		console.log(`🔌 [WorkerExecutor] Worker registered port ${port}`);

		// Store the message port for sending requests to worker
		this.portRequestChannels.set(port, requestPort);

		// Register a proxy handler in main thread's portRegistry
		if (this.portRegistry) {
			const proxyHandler = (vReq: any, vRes: any) => {
				const requestId = crypto.randomUUID();
				console.log(`🌐 [WorkerExecutor] Forwarding HTTP request to worker port ${port}: ${vReq.method} ${vReq.url}`);

				// Send request to worker
				requestPort.postMessage({
					requestId,
					method: vReq.method,
					url: vReq.url,
					headers: vReq.headers,
					body: vReq.body
				});

				// Wait for response
				const pending = new Promise<{ statusCode: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
					this.pendingPortRequests.set(requestId, { resolve, reject });

					// Timeout after 30 seconds
					setTimeout(() => {
						if (this.pendingPortRequests.has(requestId)) {
							this.pendingPortRequests.delete(requestId);
							reject(new Error('Worker HTTP request timeout'));
						}
					}, 30000);
				});

				// Fill response asynchronously
				pending.then((response) => {
					vRes.statusCode = response.statusCode;
					vRes.headers = response.headers;
					vRes.body = response.body;
				}).catch((error) => {
					vRes.statusCode = 500;
					vRes.headers = {};
					vRes.body = `Worker error: ${error.message}`;
				});

				// Return the promise so caller can await async middleware
				(vRes as any)._donePromise = pending;
			};

			this.portRegistry.set(port, proxyHandler);
			console.log(`✅ [WorkerExecutor] Registered proxy handler for port ${port} in main thread`);
		}
	}

	private handlePortUnregister(msg: WorkerMessage & { type: 'portUnregister' }): void {
		const { port } = msg;
		console.log(`🔌 [WorkerExecutor] Worker unregistered port ${port}`);

		// Remove from portRegistry
		if (this.portRegistry) {
			this.portRegistry.delete(port);
			console.log(`✅ [WorkerExecutor] Removed port ${port} from main thread portRegistry`);
		}

		// Clean up message port
		const requestPort = this.portRequestChannels.get(port);
		if (requestPort) {
			requestPort.close();
			this.portRequestChannels.delete(port);
		}
	}

	private handlePortResponse(msg: WorkerMessage & { type: 'portResponse' }): void {
		const { requestId, statusCode, headers, body } = msg;
		console.log(`🌐 [WorkerExecutor] Received HTTP response from worker: ${statusCode}`);

		const pending = this.pendingPortRequests.get(requestId);
		if (pending) {
			this.pendingPortRequests.delete(requestId);
			pending.resolve({ statusCode, headers, body });
		}
	}

	private handlePortRegistryMessage(data: any, ports: readonly MessagePort[]): void {
		const { type } = data;

		if (type === 'portRegister') {
			const { port, requestPort } = data;
			console.log(`🔌 [WorkerExecutor] Worker registering port ${port} via network interface`);

			// Store the request channel
			this.portRequestChannels.set(port, requestPort || ports[0]);

			// Register proxy handler in main thread's portRegistry
			if (this.portRegistry) {
				// Must be a regular (non-async) function so _donePromise is set
				// synchronously before the caller (curl, tunnel) checks for it.
				const proxyHandler = (vReq: any, vRes: any) => {
					const requestId = crypto.randomUUID();
					console.log(`🌐 [WorkerExecutor] Forwarding request to worker port ${port}: ${vReq.method} ${vReq.url}`);

					const requestPort = this.portRequestChannels.get(port);
					if (!requestPort) {
						vRes.statusCode = 500;
						vRes.body = 'Port channel not found';
						return;
					}

					// Send request to worker
					requestPort.postMessage({ requestId, method: vReq.method, url: vReq.url, headers: vReq.headers, body: vReq.body });

					const responsePromise = new Promise<any>((resolve, reject) => {
						this.pendingPortRequests.set(requestId, { resolve, reject });
						setTimeout(() => {
							if (this.pendingPortRequests.has(requestId)) {
								this.pendingPortRequests.delete(requestId);
								reject(new Error('Worker request timeout'));
							}
						}, 30000);
					});

					// Set _donePromise synchronously so callers can await it
					(vRes as any)._donePromise = responsePromise.then((response) => {
						vRes.statusCode = response.statusCode;
						vRes.headers = response.headers;
						vRes.body = response.body;
					}).catch((error) => {
						vRes.statusCode = 500;
						vRes.headers = {};
						vRes.body = String(error);
					});
				};

				this.portRegistry.set(port, proxyHandler);
				console.log(`✅ [WorkerExecutor] Port ${port} registered in main thread network interface`);
			}
		} else if (type === 'portUnregister') {
			this.handlePortUnregister(data);
		} else if (type === 'portResponse') {
			this.handlePortResponse(data);
		}
	}

	private async handleShellExecuteRequest(msg: WorkerMessage & { type: 'shellExecute' }): Promise<void> {
		console.log(`📞 [WorkerExecutor] Received shellExecute request: ${msg.cmd}`);

		if (!this.onShellExecute) {
			console.error('❌ [WorkerExecutor] shellExecute callback not available');
			this.worker?.postMessage({
				type: 'shellExecuteError',
				requestId: msg.requestId,
				error: 'shellExecute not available - no callback provided'
			} as WorkerMessage);
			return;
		}

		try {
			// Create streams from the message ports
			const { ports, ctx: serializedCtx } = msg;

			// Create output streams that write to the worker's ports
			const stdout: CommandOutputStream = {
				write: (text: string) => {
					ports.stdout.postMessage({ type: 'data', data: text });
				}
			};

			const stderr: CommandOutputStream = {
				write: (text: string) => {
					ports.stderr.postMessage({ type: 'data', data: text });
				}
			};

			// Create CommandContext for main thread execution
			const ctx: CommandContext = {
				args: serializedCtx.args,
				env: serializedCtx.env,
				cwd: serializedCtx.cwd,
				vfs: null as any, // Will be provided by shell
				stdout,
				stderr,
				stdin: undefined, // stdin not supported for shellExecute currently
				signal: new AbortController().signal,
			};

			console.log(`⚙️ [WorkerExecutor] Executing on main thread: ${msg.cmd}`);
			const exitCode = await this.onShellExecute(msg.cmd, ctx);
			console.log(`✅ [WorkerExecutor] shellExecute completed: exit=${exitCode}`);

			// Close ports
			ports.stdout.postMessage({ type: 'end' });
			ports.stderr.postMessage({ type: 'end' });

			this.worker?.postMessage({
				type: 'shellExecuteResult',
				requestId: msg.requestId,
				exitCode
			} as WorkerMessage);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`❌ [WorkerExecutor] shellExecute failed: ${errorMsg}`);

			this.worker?.postMessage({
				type: 'shellExecuteError',
				requestId: msg.requestId,
				error: errorMsg
			} as WorkerMessage);
		}
	}

	async terminate(): Promise<void> {
		this.worker?.terminate();
		this.worker = null;
		this.pendingTasks.clear();
	}
}

// Commands that run in worker threads.
// curl must stay on the main thread — it needs kernel.portRegistry to reach
// virtual servers. npm/npx run in workers and use proxyPortRegistry to bridge
// their http servers back to kernel.portRegistry on the main thread.
const THREADABLE_COMMANDS = new Set([
	'grep', 'find', 'sort', 'wc', 'uniq',
	'sed', 'awk', 'gzip', 'gunzip', 'tar',
	'diff', 'sha256sum', 'md5',
	// 'npm',
	// 'npx',
]);

/**
 * Smart executor that routes commands to either worker threads or main thread
 * based on the command type.
 */
export class RoutingExecutor implements ProcessExecutor {
	private workerExecutor: WorkerExecutor;
	private mainThreadExecutor: MainThreadExecutor;

	constructor(
		vfsDbName: string,
		registry: CommandRegistry,
		onShellExecute?: (cmd: string, ctx: CommandContext) => Promise<number>,
		onVfsReload?: () => Promise<void>,
		portRegistry?: Map<number, any>
	) {
		this.workerExecutor = new WorkerExecutor(vfsDbName, onShellExecute, onVfsReload, portRegistry);
		this.mainThreadExecutor = new MainThreadExecutor(registry);
	}

	/**
	 * Update the shellExecute callback after construction.
	 * Forwards to the WorkerExecutor.
	 */
	setShellExecute(callback: (cmd: string, ctx: CommandContext) => Promise<number>): void {
		this.workerExecutor.setShellExecute(callback);
	}

	async executeCommand(command: string, ctx: CommandContext, abortController: AbortController): Promise<number> {
		// Extract base command name (handle commands with arguments)
		const baseCommand = command.split(/\s+/)[0];

		const shouldUseWorker = THREADABLE_COMMANDS.has(baseCommand);

		if (shouldUseWorker) {
			console.log(`🧵 [ProcessExecutor] Routing to WORKER: ${command}`);
			return this.workerExecutor.executeCommand(command, ctx, abortController);
		} else {
			console.log(`📌 [ProcessExecutor] Running on MAIN THREAD: ${command}`);
			return this.mainThreadExecutor.executeCommand(command, ctx);
		}
	}

	async terminate(): Promise<void> {
		await Promise.all([
			this.workerExecutor.terminate(),
			this.mainThreadExecutor.terminate()
		]);
	}
}

export function createProcessExecutor(
	vfsDbName: string,
	registry: CommandRegistry,
	enableWorker = true,
	onShellExecute?: (cmd: string, ctx: CommandContext) => Promise<number>,
	onVfsReload?: () => Promise<void>,
	portRegistry?: Map<number, any>
): ProcessExecutor {
	if (!enableWorker) {
		console.log('⚠️ [ProcessExecutor] Worker threads DISABLED - all commands run on main thread');
		return new MainThreadExecutor(registry);
	}
	console.log('✅ [ProcessExecutor] Worker threads ENABLED - routing CPU-intensive commands to workers');
	return new RoutingExecutor(vfsDbName, registry, onShellExecute, onVfsReload, portRegistry);
}
