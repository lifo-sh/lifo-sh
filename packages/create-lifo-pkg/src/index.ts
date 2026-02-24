import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateTemplates } from './templates.js';

// ─── CLI ───

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: npm create lifo-pkg <name>\n');
  console.log('Scaffold a new Lifo package.\n');
  console.log('Examples:');
  console.log('  npm create lifo-pkg hello');
  console.log('  npm create lifo-pkg my-tool');
  console.log('  npx create-lifo-pkg ffmpeg\n');
  console.log('This creates a lifo-pkg-<name> directory with:');
  console.log('  src/index.ts      Command source');
  console.log('  example/          Vite app for browser testing');
  console.log('  test-cli.js       CLI test harness');
  console.log('  vite.config.ts    Build configuration');
  process.exit(args.length === 0 ? 1 : 0);
}

const name = args[0].replace(/^lifo-pkg-/, '');
const npmName = `lifo-pkg-${name}`;
const targetDir = path.resolve(process.cwd(), npmName);

if (fs.existsSync(targetDir)) {
  console.error(`Error: ${targetDir} already exists`);
  process.exit(1);
}

console.log(`\nCreating ${npmName}...\n`);

const files = generateTemplates({ name, npmName });

for (const file of files) {
  const fullPath = path.join(targetDir, file.path);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, file.content, 'utf-8');
  console.log(`  ${file.path}`);
}

console.log(`\nDone! Next steps:\n`);
console.log(`  cd ${npmName}`);
console.log(`  npm install`);
console.log(`  cd example && npm install && cd ..`);
console.log(`  npm run build`);
console.log(`  npm run dev              # watch mode (rebuild on changes)`);
console.log(`  npm run test:browser     # test in browser`);
console.log(`  npm run test:cli         # test in terminal\n`);
