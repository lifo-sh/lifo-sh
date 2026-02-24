# lifo-sh

CLI for [Lifo](https://github.com/lifo-sh/lifo) -- a Linux-like OS that runs natively in JavaScript. Run Lifo directly in your terminal.

## Quick Start

```bash
npx lifo-sh
```

## Install

```bash
npm install -g lifo-sh
lifo
```

## What You Get

A full shell environment with 60+ commands, powered by `@lifo-sh/core`:

- Bash-like shell with pipes, redirects, globs, variables, tab completion, history
- Virtual filesystem with standard Unix hierarchy
- Commands: `ls`, `grep`, `awk`, `sed`, `curl`, `find`, `tar`, `node`, and more
- Node.js compatibility layer for running JS scripts

```
 _     _  __
| |   (_)/ _| ___
| |   | | |_ / _ \
| |___| |  _| (_) |
|_____|_|_|  \___/

user@lifo:~$ ls
examples
user@lifo:~$ echo hello | tr a-z A-Z
HELLO
user@lifo:~$ node -e "console.log(2 + 2)"
4
```

## Packages

| Package | Description |
|---|---|
| [@lifo-sh/core](https://www.npmjs.com/package/@lifo-sh/core) | Kernel, shell, commands, sandbox API |
| [@lifo-sh/ui](https://www.npmjs.com/package/@lifo-sh/ui) | Terminal UI (xterm.js wrapper) |
| **lifo-sh** | CLI -- run Lifo in your terminal |

## Links

- [GitHub](https://github.com/lifo-sh/lifo)
- [Issues](https://github.com/lifo-sh/lifo/issues)

## License

MIT
