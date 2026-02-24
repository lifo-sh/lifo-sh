import {
  Kernel,
  Shell,
  createDefaultRegistry,
  loadInstalledPackages,
  createPkgCommand,
  createPsCommand,
  createTopCommand,
  createKillCommand,
  createWatchCommand,
  createHelpCommand,
  createNodeCommand,
  createCurlCommand,
} from '@lifo-sh/core';
import { NodeTerminal } from './NodeTerminal.js';

async function main() {
  const terminal = new NodeTerminal();

  // 1. Boot kernel
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  // 2. Create command registry
  const registry = createDefaultRegistry();
  registry.register('pkg', createPkgCommand(registry));
  loadInstalledPackages(kernel.vfs, registry);

  // 3. Set up environment
  const env = kernel.getDefaultEnv();

  // 4. Create shell
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  // 5. Register factory commands that need shell/kernel references
  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  // 6. Source config files
  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');

  // 7. Override exit to actually terminate the process
  (shell as any).builtins.set(
    'exit',
    async () => {
      terminal.write('logout\r\n');
      cleanup();
      return 0;
    },
  );

  // 8. Display MOTD, then start interactive shell
  const motd = kernel.vfs.readFileString('/etc/motd');
  terminal.write(motd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));

  shell.start();

  // Cleanup handler
  function cleanup() {
    terminal.destroy();
    process.exit(0);
  }

  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
