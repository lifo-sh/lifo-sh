// Sandbox (high-level API)
export { Sandbox } from './sandbox/index.js';
export type {
	SandboxOptions,
	RunOptions,
	CommandResult,
	SandboxCommands,
	SandboxFs,
} from './sandbox/index.js';

// Kernel
export { Kernel } from '@lifo-sh/kernel';
export type { VirtualRequest, VirtualResponse, VirtualRequestHandler } from '@lifo-sh/kernel';

// Network Stack
export { NetworkStack } from '@lifo-sh/kernel/network';
export type {
	IPAddress,
	SocketType,
	SocketAddress,
	NetworkInterface as INetworkInterface,
	RouteEntry,
	NetworkTunnel,
	TunnelType,
} from '@lifo-sh/kernel/network';

// Tunnels
export { VETHPair } from '@lifo-sh/kernel/network';
export { WebSocketTunnel } from '@lifo-sh/kernel/network';

// Bridge
export { Bridge } from '@lifo-sh/kernel/network';

// VFS
export { VFS, VFSError, ErrorCode } from '@lifo-sh/kernel';
export { getMimeType, getFileCategory, isBinaryMime } from '@lifo-sh/kernel';
export { NativeFsProvider } from '@lifo-sh/kernel';
export type {
	INode,
	Stat,
	Dirent,
	FileType,
	ErrorCodeType,
	VirtualProvider,
	MountProvider,
	NativeFsModule,
	VFSWatchEvent,
	VFSWatchListener,
	VFSEventType,
} from '@lifo-sh/kernel';

// Blob storage & content store
export { MemoryBlobStore, IndexedDBBlobStore, hashBytes } from '@lifo-sh/kernel/storage';
export { ContentStore, CHUNK_THRESHOLD, CHUNK_SIZE } from '@lifo-sh/kernel/storage';
export type { BlobStore } from '@lifo-sh/kernel/storage';

// Persistence
export { PersistenceManager } from '@lifo-sh/kernel/persistence';
export { IndexedDBPersistenceBackend, MemoryPersistenceBackend } from '@lifo-sh/kernel/persistence';
export type { PersistenceBackend } from '@lifo-sh/kernel/persistence';
export { serialize, deserialize } from '@lifo-sh/kernel/persistence';
export type { SerializedNode } from '@lifo-sh/kernel/persistence';

// Commands
export { CommandRegistry, createDefaultRegistry } from './commands/registry.js';
export type {
	Command,
	CommandContext,
	CommandOutputStream,
	CommandInputStream,
} from './commands/types.js';

// Factory commands
export { createPsCommand } from './commands/system/ps.js';
export { createTopCommand } from './commands/system/top.js';
export { createKillCommand } from './commands/system/kill.js';
export { createWatchCommand } from './commands/system/watch.js';
export { createHelpCommand } from './commands/system/help.js';
export { createNodeCommand } from './commands/system/node.js';
export { createCurlCommand } from './commands/net/curl.js';
export { createTunnelCommandV2 } from './commands/net/tunnel-v2.js';
export { createIfconfigCommand } from './commands/net/ifconfig.js';
export { createRouteCommand } from './commands/net/route.js';
export { createNetstatCommand } from './commands/net/netstat.js';
export { createHostCommand } from './commands/net/host.js';
export { createIPCommand } from './commands/net/ip.js';
export { createTunnelCommand } from './commands/net/tunnel.js';
export { createForwardCommand, createUnforwardCommand } from './commands/net/forward.js';
export { createPortsCommand } from './commands/net/ports.js';
export { createTestRegistryCommand } from './commands/net/test-registry.js';
export { createLifoPkgCommand, bootLifoPackages, rehydrateGlobalPackages } from './commands/system/lifo.js';
export { createNpmCommand, createNpxCommand } from './commands/system/npm.js';
export { createLogoutCommand } from './commands/system/logout.js';
export { createSystemctlCommand } from './commands/system/systemctl.js';
export { createNewtabCommand } from './commands/system/newtab.js';

// Service manager
export { ServiceManager } from '@lifo-sh/kernel';
export type { ServiceInfo } from '@lifo-sh/kernel';
export type { UnitFile } from '@lifo-sh/kernel';
export { parseUnitFile } from '@lifo-sh/kernel';

// Shell
export { Shell } from './shell/Shell.js';
export { JobTable } from './shell/jobs.js';
export { ProcessRegistry } from './shell/ProcessRegistry.js';
export type { Process, SpawnOptions } from './shell/ProcessRegistry.js';

// Runtime
export {
  createProcessExecutor,
  MainThreadExecutor,
  WorkerExecutor,
} from './runtime/ProcessExecutor.js';
export type { ProcessExecutor } from './runtime/ProcessExecutor.js';

// Terminal
export type { ITerminal } from './terminal/ITerminal.js';
export { HeadlessTerminal } from './sandbox/HeadlessTerminal.js';

// Lifo runtime
export { createLifoCommand, readLifoManifest } from './pkg/lifo-runtime.js';
export type { LifoAPI, LifoPackageManifest } from './pkg/lifo-runtime.js';
export { linkPackage, unlinkPackage, loadDevLinks } from './pkg/lifo-dev.js';
export type { DevLink, DevLinksMap } from './pkg/lifo-dev.js';

// Node compatibility
export { createModuleMap, ProcessExitError } from '@lifo-sh/node-compat';
export type { NodeContext } from '@lifo-sh/node-compat';
export { Buffer } from '@lifo-sh/node-compat/buffer';

// Path utilities
export { resolve, dirname, join, normalize, basename, extname } from './utils/path.js';

// Color utilities
export {
	RESET,
	BOLD,
	DIM,
	ITALIC,
	UNDERLINE,
	RED,
	GREEN,
	YELLOW,
	BLUE,
	MAGENTA,
	CYAN,
	WHITE,
	BRIGHT_RED,
	BRIGHT_GREEN,
	BRIGHT_YELLOW,
	BRIGHT_BLUE,
	BRIGHT_MAGENTA,
	BRIGHT_CYAN,
	red,
	green,
	yellow,
	blue,
	magenta,
	cyan,
	bold,
	dim,
} from './utils/colors.js';
