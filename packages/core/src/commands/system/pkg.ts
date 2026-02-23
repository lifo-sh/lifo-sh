import type { Command, CommandContext } from '../types.js';
import type { CommandRegistry } from '../registry.js';
import { PackageManager } from '../../pkg/PackageManager.js';

export function createPkgCommand(registry: CommandRegistry): Command {
  const command: Command = async (ctx) => {
    const subcommand = ctx.args[0];
    const pm = new PackageManager(ctx.vfs);

    if (!subcommand || subcommand === '--help') {
      ctx.stdout.write('Usage: pkg <command> [args]\n\n');
      ctx.stdout.write('Commands:\n');
      ctx.stdout.write('  install <url> [name]   install a package from URL\n');
      ctx.stdout.write('  remove <name>          remove an installed package\n');
      ctx.stdout.write('  list                   list installed packages\n');
      ctx.stdout.write('  info <name>            show package details\n');
      return subcommand ? 0 : 1;
    }

    switch (subcommand) {
      case 'install': {
        const url = ctx.args[1];
        if (!url) {
          ctx.stderr.write('pkg: install requires a URL\n');
          return 1;
        }
        const name = ctx.args[2];

        try {
          ctx.stdout.write(`Fetching ${url}...\n`);
          const info = await pm.install(url, name);
          ctx.stdout.write(`Installed ${info.name} (${info.size} bytes)\n`);

          // Register as command
          registerPkgCommand(registry, ctx, info.name);

          ctx.stdout.write(`Command '${info.name}' is now available\n`);
        } catch (e) {
          ctx.stderr.write(`pkg: install failed: ${e instanceof Error ? e.message : String(e)}\n`);
          return 1;
        }
        return 0;
      }

      case 'remove': {
        const name = ctx.args[1];
        if (!name) {
          ctx.stderr.write('pkg: remove requires a package name\n');
          return 1;
        }
        if (pm.remove(name)) {
          ctx.stdout.write(`Removed ${name}\n`);
        } else {
          ctx.stderr.write(`pkg: package '${name}' not found\n`);
          return 1;
        }
        return 0;
      }

      case 'list': {
        const packages = pm.list();
        if (packages.length === 0) {
          ctx.stdout.write('No packages installed\n');
        } else {
          for (const pkg of packages) {
            const date = new Date(pkg.installedAt).toLocaleDateString();
            ctx.stdout.write(`${pkg.name.padEnd(20)} ${String(pkg.size).padStart(8)} bytes  ${date}\n`);
          }
        }
        return 0;
      }

      case 'info': {
        const name = ctx.args[1];
        if (!name) {
          ctx.stderr.write('pkg: info requires a package name\n');
          return 1;
        }
        const info = pm.info(name);
        if (!info) {
          ctx.stderr.write(`pkg: package '${name}' not found\n`);
          return 1;
        }
        ctx.stdout.write(`Name:      ${info.name}\n`);
        ctx.stdout.write(`URL:       ${info.url}\n`);
        ctx.stdout.write(`Size:      ${info.size} bytes\n`);
        ctx.stdout.write(`Installed: ${new Date(info.installedAt).toISOString()}\n`);
        return 0;
      }

      default:
        ctx.stderr.write(`pkg: unknown command '${subcommand}'\n`);
        return 1;
    }
  };

  return command;
}

function registerPkgCommand(registry: CommandRegistry, _ctx: CommandContext, name: string): void {
  const scriptPath = `/usr/share/pkg/node_modules/${name}/index.js`;
  registry.registerLazy(name, () =>
    import('./node.js').then((mod) => ({
      default: ((cmdCtx: CommandContext) =>
        mod.default({
          ...cmdCtx,
          args: [scriptPath, ...cmdCtx.args],
        })) as Command,
    })),
  );
}
