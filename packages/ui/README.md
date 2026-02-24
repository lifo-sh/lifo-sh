# @lifo-sh/ui

Terminal UI package for [Lifo](https://github.com/lifo-sh/lifo) -- a Linux-like OS that runs natively in the browser. Wraps xterm.js with WebGL rendering and auto-fit.

## Install

```bash
npm install @lifo-sh/ui @lifo-sh/core
```

## Usage

Typically used via `@lifo-sh/core`'s Sandbox API:

```typescript
import { Sandbox } from '@lifo-sh/core';

const sandbox = await Sandbox.create({
  terminal: '#terminal-container',
});
```

`@lifo-sh/core` lazy-loads `@lifo-sh/ui` when a DOM element is passed as the `terminal` option.

### Standalone

```typescript
import { Terminal } from '@lifo-sh/ui';

const terminal = new Terminal(document.getElementById('terminal'));
terminal.write('Hello from Lifo!\r\n');
```

## What's Included

- xterm.js terminal emulator
- WebGL renderer for GPU-accelerated rendering
- Auto-fit addon for responsive sizing
- Implements the `ITerminal` interface from `@lifo-sh/core`

## Packages

| Package | Description |
|---|---|
| [@lifo-sh/core](https://www.npmjs.com/package/@lifo-sh/core) | Kernel, shell, commands, sandbox API |
| **@lifo-sh/ui** | Terminal UI (xterm.js wrapper) |
| [lifo-sh](https://www.npmjs.com/package/lifo-sh) | CLI -- run Lifo in your terminal |

## Links

- [GitHub](https://github.com/lifo-sh/lifo)
- [Issues](https://github.com/lifo-sh/lifo/issues)

## License

MIT
