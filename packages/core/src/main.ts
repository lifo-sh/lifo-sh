import { Kernel } from '@lifo-sh/kernel';
import { Terminal } from './terminal/Terminal.js';
import { Shell } from './shell/Shell.js';
import { createDefaultRegistry } from './commands/registry.js';
import { createProcessExecutor } from './runtime/ProcessExecutor.js';
import { createPsCommand } from './commands/system/ps.js';
import { createTopCommand } from './commands/system/top.js';
import { createKillCommand } from './commands/system/kill.js';
import { createWatchCommand } from './commands/system/watch.js';
import { createHelpCommand } from './commands/system/help.js';
import { createNpmCommand, createNpxCommand } from './commands/system/npm.js';
import { createLifoPkgCommand, bootLifoPackages } from './commands/system/lifo.js';
import { createSystemctlCommand } from './commands/system/systemctl.js';
import { createNodeCommand } from './commands/system/node.js';
import { createPortsCommand } from './commands/net/ports.js';
import { createNetstatCommand } from './commands/net/netstat.js';
import { createTunnelCommand } from './commands/net/tunnel.js';
import { createForwardCommand, createUnforwardCommand } from './commands/net/forward.js';
import { createCurlCommand } from './commands/net/curl.js';
import { createIfconfigCommand } from './commands/net/ifconfig.js';
import { createIPCommand } from './commands/net/ip.js';
import { createRouteCommand } from './commands/net/route.js';
import { createHostCommand } from './commands/net/host.js';

async function boot(): Promise<void> {
	// 1. Kernel & filesystem (async -- loads persisted data)
	const kernel = new Kernel();
	await kernel.boot();

	// 2. Create VFS proxy (all process-level access goes through this)
	const vfsProxy = kernel.createVfsProxy();

	// 3. Terminal
	const container = document.getElementById('terminal');
	if (!container) throw new Error('Missing #terminal element');
	const terminal = new Terminal(container);

	// 4. Command registry
	const registry = createDefaultRegistry();

	// 4a. Initialize kernel's process executor with registry
	kernel.setProcessExecutor(createProcessExecutor(kernel, registry));

	// 4b. Boot lifo packages (dev links + installed lifo-pkg-* upgrades)
	bootLifoPackages(vfsProxy, registry);

	// 5. Display MOTD
	const motd = vfsProxy.readFileString('/etc/motd');
	// Convert \n to \r\n for xterm
	terminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));

	// 6. Shell
	const env = kernel.getDefaultEnv();
	const shell = new Shell(terminal, kernel, registry, env);

	// 6a. Initialize kernel process API (syscall layer for child_process fork/spawn)
	kernel.initProcessAPI({ cwd: env.HOME, env });

	// 6b. Register factory commands that need shell/registry access
	registry.register('ps', createPsCommand(kernel));
	registry.register('top', createTopCommand(kernel));
	registry.register('kill', createKillCommand(kernel));
	registry.register('node', createNodeCommand(kernel));
	registry.register('ports', createPortsCommand(kernel));
	registry.register('netstat', createNetstatCommand(kernel));
	registry.register('tunnel', createTunnelCommand(kernel));
	registry.register('forward', createForwardCommand(kernel));
	registry.register('unforward', createUnforwardCommand(kernel));
	registry.register('curl', createCurlCommand(kernel));
	registry.register('ifconfig', createIfconfigCommand(kernel));
	registry.register('ip', createIPCommand(kernel));
	registry.register('route', createRouteCommand(kernel));
	registry.register('host', createHostCommand(kernel));
	registry.register('watch', createWatchCommand(kernel, registry));
	registry.register('help', createHelpCommand(kernel));

	// 5c. Register npm with shell execution support
	const npmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
		const result = await shell.execute(cmd, {
			cwd: cmdCtx.cwd,
			env: cmdCtx.env,
			onStdout: (data: string) => cmdCtx.stdout.write(data),
			onStderr: (data: string) => cmdCtx.stderr.write(data),
		});
		return result.exitCode;
	};
	registry.register('npm', createNpmCommand(kernel, registry, npmShellExecute));
	registry.register('npx', createNpxCommand(kernel, registry, npmShellExecute));
	registry.register('lifo', createLifoPkgCommand(kernel, registry, npmShellExecute));

	// 5d. Service manager & systemctl
	kernel.initServiceManager(registry, env);
	registry.register('systemctl', createSystemctlCommand(kernel));

	// 6. Boot enabled services
	await kernel.bootServices();

	// 7. Start shell & focus
	shell.start();
	terminal.focus();
}

boot();
