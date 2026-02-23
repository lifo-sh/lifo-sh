import type { Command } from '../types.js';
import { resolve, extname } from '../../utils/path.js';
import { VFSError } from '../../kernel/vfs/index.js';

const extTypes: Record<string, string> = {
  '.txt': 'ASCII text',
  '.md': 'Markdown text',
  '.js': 'JavaScript source',
  '.ts': 'TypeScript source',
  '.json': 'JSON data',
  '.html': 'HTML document',
  '.css': 'CSS stylesheet',
  '.sh': 'Shell script',
  '.py': 'Python script',
  '.xml': 'XML document',
  '.yaml': 'YAML data',
  '.yml': 'YAML data',
  '.csv': 'CSV data',
  '.svg': 'SVG image',
  '.png': 'PNG image data',
  '.jpg': 'JPEG image data',
  '.gif': 'GIF image data',
};

function isText(data: Uint8Array): boolean {
  // Check if all bytes are valid UTF-8 / printable ASCII
  for (let i = 0; i < Math.min(data.length, 512); i++) {
    const b = data[i];
    // Allow common text bytes: tab, newline, carriage return, printable ASCII
    if (b === 9 || b === 10 || b === 13) continue;
    if (b >= 32 && b <= 126) continue;
    // Allow UTF-8 continuation bytes
    if (b >= 128) continue;
    // Control characters that aren't typical in text
    return false;
  }
  return true;
}

const command: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    ctx.stderr.write('file: missing operand\n');
    return 1;
  }

  let exitCode = 0;

  for (const arg of ctx.args) {
    const path = resolve(ctx.cwd, arg);
    try {
      const st = ctx.vfs.stat(path);

      if (st.type === 'directory') {
        ctx.stdout.write(`${arg}: directory\n`);
        continue;
      }

      if (st.size === 0) {
        ctx.stdout.write(`${arg}: empty\n`);
        continue;
      }

      // Check by extension first
      const ext = extname(arg);
      if (ext && extTypes[ext]) {
        ctx.stdout.write(`${arg}: ${extTypes[ext]}\n`);
        continue;
      }

      // Check content
      const data = ctx.vfs.readFile(path);
      if (isText(data)) {
        ctx.stdout.write(`${arg}: ASCII text\n`);
      } else {
        ctx.stdout.write(`${arg}: data\n`);
      }
    } catch (e) {
      if (e instanceof VFSError) {
        ctx.stderr.write(`file: ${arg}: ${e.message}\n`);
        exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return exitCode;
};

export default command;
