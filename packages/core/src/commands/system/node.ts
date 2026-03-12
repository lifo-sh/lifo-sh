import type { Command } from '../types.js';
import { resolve, dirname } from '../../utils/path.js';
import { NodeRunner } from '@lifo-sh/node-runner';
import { createModuleMap } from '@lifo-sh/node-compat';
import type { NodeContext } from '@lifo-sh/node-compat';
import { VFSError } from '@lifo-sh/kernel';
import { ACTIVE_SERVERS } from '@lifo-sh/node-compat/http';
import type { VirtualRequestHandler, Kernel, IKernel } from '@lifo-sh/kernel';

const NODE_VERSION = 'v20.0.0';

// ── Rollup / esbuild CJS-ESM interop helpers ──
const _rollupHelpers: Record<string, (...args: unknown[]) => unknown> = {
	getDefaultExportFromCjs(x: unknown): unknown {
		const o = x as Record<string, unknown>;
		return o && o.__esModule && Object.prototype.hasOwnProperty.call(o, 'default') ? o.default : o;
	},
	getDefaultExportFromNamespaceIfPresent(n: unknown): unknown {
		const o = n as Record<string, unknown>;
		return o && Object.prototype.hasOwnProperty.call(o, 'default') && Object.keys(o).length === 1 ? o.default : o;
	},
	getAugmentedNamespace(n: unknown): unknown {
		const o = n as Record<string, unknown>;
		if (o.__esModule) return o;
		const a: Record<string, unknown> = Object.defineProperty({}, '__esModule', { value: true });
		Object.keys(o).forEach(function (k) {
			const d = Object.getOwnPropertyDescriptor(o, k);
			Object.defineProperty(a, k, d && d.get ? d : { enumerable: true, get() { return o[k]; } });
		});
		a.default = n;
		return Object.freeze(a);
	},
	_mergeNamespaces(n: unknown, ...ms: unknown[]): unknown {
		const o = n as Record<string, unknown>;
		const modules = ms.flat() as Array<Record<string, unknown>>;
		for (const m of modules) {
			for (const k of Object.keys(m)) {
				if (k !== 'default' && !(k in o)) {
					Object.defineProperty(o, k, { enumerable: true, get: () => m[k] });
				}
			}
		}
		return Object.freeze(o);
	},
};

export function createNodeImpl(
	kernelOrPortRegistry?: Kernel | IKernel | Map<number, VirtualRequestHandler>,
	shellExecuteFn?: (cmd: string, ctx: any) => Promise<number>,
): Command {
	return async (ctx) => {
		// Handle -v/--version
		if (ctx.args.length > 0 && (ctx.args[0] === '-v' || ctx.args[0] === '--version')) {
			ctx.stdout.write(NODE_VERSION + '\n');
			return 0;
		}

		// Handle --help
		if (ctx.args.length > 0 && ctx.args[0] === '--help') {
			ctx.stdout.write('Usage: node [-e code] [script.js] [args...]\n');
			ctx.stdout.write('       node -v\n\n');
			ctx.stdout.write('Options:\n');
			ctx.stdout.write('  -e, --eval <code>   evaluate code\n');
			ctx.stdout.write('  -v, --version       print version\n\n');
			ctx.stdout.write('Limitations:\n');
			ctx.stdout.write('  - ESM support via auto-transform (import/export → require/exports)\n');
			ctx.stdout.write('  - No event loop (top-level await does not settle)\n');
			ctx.stdout.write('  - No native modules\n');
			ctx.stdout.write('  - require() resolves: built-in modules, relative VFS files, installed packages\n');
			return 0;
		}

		let source: string;
		let filename: string;
		let scriptArgs: string[];

		// Handle -e / --eval
		if (ctx.args.length > 0 && (ctx.args[0] === '-e' || ctx.args[0] === '--eval')) {
			if (ctx.args.length < 2) {
				ctx.stderr.write('node: -e requires an argument\n');
				return 1;
			}
			source = ctx.args[1];
			filename = '[eval]';
			scriptArgs = ctx.args.slice(2);
		} else if (ctx.args.length > 0) {
			const scriptPath = resolve(ctx.cwd, ctx.args[0]);
			try {
				source = ctx.vfs.readFileString(scriptPath);
			} catch (e) {
				if (e instanceof VFSError) {
					ctx.stderr.write(`node: ${ctx.args[0]}: ${e.message}\n`);
					return 1;
				}
				throw e;
			}
			filename = scriptPath;
			scriptArgs = ctx.args.slice(1);
		} else {
			ctx.stderr.write('Usage: node [-e code] [script.js] [args...]\n');
			return 1;
		}

		const dir = filename === '[eval]' ? ctx.cwd : dirname(filename);

		// Distinguish kernel object (Kernel or WorkerKernel) from bare Map
		const isKernelLike = kernelOrPortRegistry && 'vfs' in kernelOrPortRegistry;
		const portRegistry = isKernelLike
			? kernelOrPortRegistry.portRegistry
			: kernelOrPortRegistry as Map<number, VirtualRequestHandler> | undefined;

		// Extract processAPI from kernel (works for both Kernel and WorkerKernel)
		const kernel = isKernelLike ? kernelOrPortRegistry : undefined;
		const processAPI = kernel?.processAPI ?? undefined;

		// Create executeCapture: runs a shell command and captures stdout.
		// Used by child_process as fallback when processAPI is unavailable (e.g. worker).
		// Prefer kernel's shell callback, fall back to explicitly passed shellExecuteFn.
		const resolvedShellExecute = (kernel as any)?.getShellExecute?.() ?? shellExecuteFn;
		const executeCapture = resolvedShellExecute
			? async (cmd: string): Promise<string> => {
				let out = '';
				await resolvedShellExecute(cmd, {
					cwd: ctx.cwd,
					env: ctx.env,
					stdout: { write: (s: string) => { out += s; } },
					stderr: { write: (_s: string) => {} },
				});
				return out;
			}
			: undefined;

		const nodeCtx: NodeContext = {
			vfs: ctx.vfs,
			cwd: ctx.cwd,
			env: ctx.env,
			stdout: ctx.stdout,
			stderr: ctx.stderr,
			argv: [filename, ...scriptArgs],
			filename,
			dirname: dir,
			signal: ctx.signal,
			portRegistry: portRegistry as NodeContext['portRegistry'],
			processAPI: processAPI ?? undefined,
			executeCapture,
		};

		const moduleMap = createModuleMap(nodeCtx);

		const runner = new NodeRunner({
			vfs: ctx.vfs,
			moduleMap,
			env: ctx.env,
			cwd: ctx.cwd,
			argv: [filename, ...scriptArgs],
			stdout: ctx.stdout,
			stderr: ctx.stderr,
			signal: ctx.signal,
			globalShims: _rollupHelpers,
		});


		const result = filename === '[eval]'
			? await runner.runScript(source, filename)
			: await runner.runFile(filename);

		// Check if any HTTP servers were started (long-running process)
		const getActiveServers = () => {
			const httpMod = runner.moduleCache.get('http') as { [key: symbol]: unknown[] } | undefined;
			return httpMod?.[ACTIVE_SERVERS] as Array<{ getPromise(): Promise<void> | null; close(): void }> | undefined;
		};

		let activeServers = getActiveServers();
		if ((!activeServers || activeServers.length === 0) && runner.moduleCache.has('http')) {
			const deadline = Date.now() + 2000;
			while (Date.now() < deadline) {
				await new Promise<void>((r) => setTimeout(r, 50));
				activeServers = getActiveServers();
				if (activeServers && activeServers.length > 0) break;
				if (ctx.signal.aborted) break;
			}
		}

		if (activeServers && activeServers.length > 0) {
			const serverPromises = activeServers
				.map((s) => s.getPromise())
				.filter((p): p is Promise<void> => p !== null);

			if (serverPromises.length > 0) {
				const abortPromise = new Promise<void>((resolve) => {
					if (ctx.signal.aborted) { resolve(); return; }
					ctx.signal.addEventListener('abort', () => resolve(), { once: true });
				});

				await Promise.race([
					Promise.all(serverPromises),
					abortPromise,
				]);

				if (ctx.signal.aborted) {
					for (const server of [...activeServers]) {
						server.close();
					}
				}
			}
		}

		// Check if any child processes were spawned (long-running process)
		const ACTIVE_CHILD_PROCESSES = Symbol.for('lifo:activeChildProcesses');
		const getActiveChildren = () => {
			const cpMod = runner.moduleCache.get('child_process') as Record<symbol, unknown> | undefined;
			return cpMod?.[ACTIVE_CHILD_PROCESSES] as Array<{ exitCode: number | null; on: (event: string, fn: (...args: unknown[]) => void) => void }> | undefined;
		};

		const activeChildren = getActiveChildren();
		if (activeChildren && activeChildren.length > 0) {
			const childExitPromises = activeChildren.map(child =>
				new Promise<void>(resolve => {
					if (child.exitCode !== null) { resolve(); return; }
					child.on('exit', () => resolve());
				})
			);

			const abortPromise = new Promise<void>(resolve => {
				if (ctx.signal.aborted) { resolve(); return; }
				ctx.signal.addEventListener('abort', () => resolve(), { once: true });
			});

			await Promise.race([Promise.all(childExitPromises), abortPromise]);
		}

		return result.exitCode;
	};
}

export function createNodeCommand(kernel: Kernel): Command {
	return createNodeImpl(kernel);
}

// Default command with a shared portRegistry so http.createServer works
const defaultPortRegistry = new Map<number, VirtualRequestHandler>();
const command: Command = createNodeImpl(defaultPortRegistry);

export default command;
