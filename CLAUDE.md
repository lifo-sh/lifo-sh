# Lifo - Browser-based Linux Environment

## Project Structure
- Monorepo using Turborepo with pnpm
- `packages/core/` - Core runtime: virtual Node.js, VFS, shell, commands
- `packages/ui/` - UI components
- `packages/create-lifo-pkg/` - Package scaffolding CLI
- `my-app/` - Main application

## Key Architecture
- Virtual Node.js runtime in `packages/core/src/commands/system/node.ts` (ESM-to-CJS transform, module loading)
- Node compatibility layer in `packages/core/src/node-compat/` (fs, http, process, etc.)
- Worker thread execution in `packages/core/src/runtime/` (command-worker.ts, ProcessExecutor.ts)
- Command registry in `packages/core/src/commands/registry.ts`
- npm/npx implementation in `packages/core/src/commands/system/npm.ts`

## Worker Architecture
- `ProcessExecutor.ts`: Routes commands to worker or main thread via `THREADABLE_COMMANDS` set
- `command-worker.ts`: Web Worker that initializes its own VFS from IndexedDB, uses `proxyPortRegistry` to bridge HTTP servers to main thread
- `fakeKernel = { portRegistry: proxyPortRegistry }` is passed to npm/node commands in the worker

## Build & Dev
- `pnpm install` to install dependencies
- `pnpm dev` to start dev server
- TypeScript throughout

## Important Patterns
- `createNodeImpl(kernelOrPortRegistry)` accepts either Kernel or Map<number, VirtualRequestHandler>
- `transformEsmToCjs()` converts ESM to CJS for virtual runtime; `transformDynamicImports()` handles CJS modules with import()
- All dynamic import() must go through virtual require() in the worker (browser import() can't resolve VFS paths)
- `registerBinCommand()` in npm.ts uses `import('./node.js')` (real browser import) to create node command instances for bin scripts
