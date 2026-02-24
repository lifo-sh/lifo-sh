# @lifo-sh/core

Core engine for [Lifo](https://github.com/lifo-sh/lifo) -- a Linux-like OS that runs natively in JavaScript. Provides the kernel, virtual filesystem, shell, and 60+ commands.

Works in both browser and Node.js environments.

## Install

```bash
npm install @lifo-sh/core
```

## Quick Start

### Headless / Programmatic

```typescript
import { Sandbox } from '@lifo-sh/core';

const sandbox = await Sandbox.create();

const result = await sandbox.commands.run('echo hello world');
console.log(result.stdout); // "hello world\n"

await sandbox.fs.writeFile('/tmp/greeting.txt', 'Hi there');
const content = await sandbox.fs.readFile('/tmp/greeting.txt');
console.log(content); // "Hi there"
```

### Browser with Terminal UI

```typescript
import { Sandbox } from '@lifo-sh/core';

// Requires @lifo-sh/ui as an optional peer dependency
const sandbox = await Sandbox.create({
  terminal: '#terminal-container',
  persist: true,
});
```

## What's Included

- **Kernel** -- virtual filesystem (VFS), virtual `/proc` and `/dev` providers, IndexedDB persistence
- **Shell** -- bash-like interpreter with pipes, redirects, globs, variables, job control, tab completion, history
- **60+ commands** -- `ls`, `grep`, `awk`, `sed`, `curl`, `node`, `tar`, `find`, and more
- **Sandbox API** -- high-level `commands.run()` and `fs.*` for programmatic use
- **Node.js compat layer** -- run JS files with `node script.js` using shimmed `fs`, `path`, `http`, etc.

## Packages

| Package | Description |
|---|---|
| **@lifo-sh/core** | Kernel, shell, commands, sandbox API |
| [@lifo-sh/ui](https://www.npmjs.com/package/@lifo-sh/ui) | Terminal UI (xterm.js wrapper) |
| [lifo-sh](https://www.npmjs.com/package/lifo-sh) | CLI -- run Lifo in your terminal |

## Links

- [GitHub](https://github.com/lifo-sh/lifo)
- [Issues](https://github.com/lifo-sh/lifo/issues)

## License

MIT
