export interface Preset {
  name: string;
  category: 'esm' | 'cjs' | 'http' | 'compat' | 'edge';
  filename: string;
  code: string;
}

export const presets: Preset[] = [
  // ── ESM ──
  {
    name: 'ESM Basic',
    category: 'esm',
    filename: '/tmp/test.mjs',
    code: `import path from 'path';
import { readFileSync } from 'fs';

const resolved = path.resolve('/home/user', 'docs', 'readme.txt');
console.log('Resolved path:', resolved);

const dir = path.dirname(resolved);
console.log('Dir:', dir);
console.log('Ext:', path.extname(resolved));
console.log('Base:', path.basename(resolved));
`,
  },
  {
    name: 'ESM Re-export',
    category: 'esm',
    filename: '/tmp/test-reexport.mjs',
    code: `// Test ESM re-exports and named exports
// First, write a helper module
import fs from 'fs';

fs.mkdirSync('/tmp/mylib', { recursive: true });
fs.writeFileSync('/tmp/mylib/math.mjs', \`
export const PI = 3.14159;
export function add(a, b) { return a + b; }
export function multiply(a, b) { return a * b; }
export default { name: 'math-lib' };
\`);

fs.writeFileSync('/tmp/mylib/index.mjs', \`
export { PI, add } from './math.mjs';
export { multiply as mul } from './math.mjs';
export { default as mathMeta } from './math.mjs';
\`);

// Now import from the barrel
const lib = await import('/tmp/mylib/index.mjs');
console.log('PI:', lib.PI);
console.log('add(2,3):', lib.add(2, 3));
console.log('mul(4,5):', lib.mul(4, 5));
console.log('meta:', lib.mathMeta);
console.log('All exports:', Object.keys(lib));
`,
  },

  // ── CJS ──
  {
    name: 'CJS Require',
    category: 'cjs',
    filename: '/tmp/test.cjs',
    code: `const path = require('path');
const fs = require('fs');

// Write a CJS module
fs.mkdirSync('/tmp/cjs-test', { recursive: true });
fs.writeFileSync('/tmp/cjs-test/greet.js', \`
module.exports = function greet(name) {
  return 'Hello, ' + name + '!';
};
\`);

const greet = require('/tmp/cjs-test/greet.js');
console.log(greet('Virtual Node'));

// Test module.exports object pattern
fs.writeFileSync('/tmp/cjs-test/config.js', \`
module.exports = {
  version: '1.0.0',
  features: ['vfs', 'esm', 'cjs'],
};
\`);

const config = require('/tmp/cjs-test/config.js');
console.log('Config:', JSON.stringify(config, null, 2));
`,
  },
  {
    name: 'CJS Circular',
    category: 'cjs',
    filename: '/tmp/test-circular.js',
    code: `const fs = require('fs');

// Test circular dependency handling
fs.mkdirSync('/tmp/circular', { recursive: true });

fs.writeFileSync('/tmp/circular/a.js', \`
console.log('a: loading');
exports.loaded = false;
const b = require('./b.js');
console.log('a: b.loaded =', b.loaded);
exports.loaded = true;
console.log('a: done');
\`);

fs.writeFileSync('/tmp/circular/b.js', \`
console.log('b: loading');
exports.loaded = false;
const a = require('./a.js');
console.log('b: a.loaded =', a.loaded);
exports.loaded = true;
console.log('b: done');
\`);

const a = require('/tmp/circular/a.js');
console.log('\\nFinal: a.loaded =', a.loaded);
`,
  },

  // ── HTTP ──
  {
    name: 'HTTP Server',
    category: 'http',
    filename: '/tmp/test-http.js',
    code: `const http = require('http');

const server = http.createServer((req, res) => {
  console.log(\`\${req.method} \${req.url}\`);

  if (req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from virtual node!' }));
  } else if (req.url === '/api/time') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ time: new Date().toISOString() }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Virtual Node HTTP Server</h1><p>Try /api/hello or /api/time</p>');
  }
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
  console.log('Test with: curl http://localhost:3000/api/hello');
});
`,
  },

  // ── Node Compat ──
  {
    name: 'fs API',
    category: 'compat',
    filename: '/tmp/test-fs.js',
    code: `const fs = require('fs');
const path = require('path');

// Write files
fs.mkdirSync('/tmp/fs-test/sub', { recursive: true });
fs.writeFileSync('/tmp/fs-test/hello.txt', 'Hello, World!');
fs.writeFileSync('/tmp/fs-test/data.json', JSON.stringify({ x: 1, y: 2 }));
fs.writeFileSync('/tmp/fs-test/sub/nested.txt', 'I am nested');

// Read files
console.log('Read:', fs.readFileSync('/tmp/fs-test/hello.txt', 'utf8'));
console.log('JSON:', JSON.parse(fs.readFileSync('/tmp/fs-test/data.json', 'utf8')));

// List directory
console.log('\\nDirectory listing:');
const entries = fs.readdirSync('/tmp/fs-test', { withFileTypes: true });
for (const entry of entries) {
  const type = entry.isDirectory() ? 'DIR ' : 'FILE';
  console.log(\`  [\${type}] \${entry.name}\`);
}

// Stat
const stat = fs.statSync('/tmp/fs-test/hello.txt');
console.log('\\nStat:', { size: stat.size, isFile: stat.isFile() });

// Exists
console.log('\\nExists /tmp/fs-test:', fs.existsSync('/tmp/fs-test'));
console.log('Exists /tmp/nope:', fs.existsSync('/tmp/nope'));

// Append
fs.appendFileSync('/tmp/fs-test/hello.txt', '\\nAppended line');
console.log('\\nAfter append:', fs.readFileSync('/tmp/fs-test/hello.txt', 'utf8'));

// Rename
fs.renameSync('/tmp/fs-test/hello.txt', '/tmp/fs-test/renamed.txt');
console.log('After rename:', fs.readdirSync('/tmp/fs-test'));

// Cleanup
fs.rmSync('/tmp/fs-test', { recursive: true });
console.log('\\nCleanup done, exists:', fs.existsSync('/tmp/fs-test'));
`,
  },
  {
    name: 'process/os',
    category: 'compat',
    filename: '/tmp/test-process.js',
    code: `const os = require('os');
const process = require('process');

console.log('=== process ===');
console.log('pid:', process.pid);
console.log('platform:', process.platform);
console.log('arch:', process.arch);
console.log('version:', process.version);
console.log('cwd:', process.cwd());
console.log('argv:', process.argv);
console.log('env.HOME:', process.env.HOME);
console.log('env.PATH:', process.env.PATH);

console.log('\\n=== os ===');
console.log('hostname:', os.hostname());
console.log('platform:', os.platform());
console.log('arch:', os.arch());
console.log('homedir:', os.homedir());
console.log('tmpdir:', os.tmpdir());
console.log('type:', os.type());
console.log('EOL repr:', JSON.stringify(os.EOL));
console.log('cpus:', os.cpus().length, 'cores');
console.log('totalmem:', (os.totalmem() / 1024 / 1024).toFixed(0), 'MB');
console.log('freemem:', (os.freemem() / 1024 / 1024).toFixed(0), 'MB');
`,
  },
  {
    name: 'path API',
    category: 'compat',
    filename: '/tmp/test-path.js',
    code: `const path = require('path');

console.log('=== path ===');
console.log('sep:', path.sep);
console.log('delimiter:', path.delimiter);

console.log('\\njoin:', path.join('/home', 'user', 'docs', 'file.txt'));
console.log('resolve:', path.resolve('foo', 'bar', 'baz'));
console.log('normalize:', path.normalize('/home/user/../admin/./docs'));
console.log('dirname:', path.dirname('/home/user/file.txt'));
console.log('basename:', path.basename('/home/user/file.txt'));
console.log('basename(.txt):', path.basename('/home/user/file.txt', '.txt'));
console.log('extname:', path.extname('/home/user/file.txt'));
console.log('isAbsolute /foo:', path.isAbsolute('/foo'));
console.log('isAbsolute foo:', path.isAbsolute('foo'));

const parsed = path.parse('/home/user/docs/file.txt');
console.log('\\nparse:', JSON.stringify(parsed, null, 2));

const formatted = path.format({ dir: '/home/user', base: 'test.js' });
console.log('format:', formatted);

console.log('\\nrelative:', path.relative('/home/user/docs', '/home/user/pics'));
`,
  },
  {
    name: 'EventEmitter',
    category: 'compat',
    filename: '/tmp/test-events.js',
    code: `const EventEmitter = require('events');

class MyEmitter extends EventEmitter {}

const emitter = new MyEmitter();

// once listener
emitter.once('init', () => {
  console.log('init fired (once)');
});

// regular listener
emitter.on('data', (payload) => {
  console.log('data:', payload);
});

emitter.on('error', (err) => {
  console.log('error caught:', err.message);
});

console.log('listener count (data):', emitter.listenerCount('data'));

emitter.emit('init');
emitter.emit('init'); // should not fire
emitter.emit('data', { id: 1, value: 'hello' });
emitter.emit('data', { id: 2, value: 'world' });
emitter.emit('error', new Error('test error'));

console.log('\\nDone');
`,
  },
  {
    name: 'Buffer',
    category: 'compat',
    filename: '/tmp/test-buffer.js',
    code: `const { Buffer } = require('buffer');

// from string
const buf1 = Buffer.from('Hello, Virtual Node!');
console.log('from string:', buf1.toString());
console.log('length:', buf1.length);
console.log('hex:', buf1.toString('hex').slice(0, 20) + '...');
console.log('base64:', buf1.toString('base64'));

// from array
const buf2 = Buffer.from([72, 101, 108, 108, 111]);
console.log('\\nfrom array:', buf2.toString());

// alloc
const buf3 = Buffer.alloc(10, 0x41);
console.log('alloc:', buf3.toString());

// concat
const combined = Buffer.concat([buf1, Buffer.from(' '), buf2]);
console.log('\\nconcat:', combined.toString());

// slice
const slice = buf1.slice(0, 5);
console.log('slice:', slice.toString());

// comparison
console.log('\\ncompare:', Buffer.compare(Buffer.from('a'), Buffer.from('b')));
console.log('isBuffer:', Buffer.isBuffer(buf1), Buffer.isBuffer('nope'));

// JSON
console.log('\\ntoJSON keys:', Object.keys(buf2.toJSON()));
`,
  },

  // ── Edge Cases ──
  {
    name: 'Dynamic Import',
    category: 'edge',
    filename: '/tmp/test-dynamic.mjs',
    code: `import fs from 'fs';

// Write modules to test dynamic import
fs.mkdirSync('/tmp/dyn', { recursive: true });
fs.writeFileSync('/tmp/dyn/util.mjs', \`
export function greet(name) { return 'Hi ' + name; }
export const VERSION = '2.0';
\`);

// Dynamic import
const mod = await import('/tmp/dyn/util.mjs');
console.log('Dynamic import result:', mod.greet('World'));
console.log('VERSION:', mod.VERSION);

// Conditional dynamic import
const moduleName = '/tmp/dyn/util.mjs';
const mod2 = await import(moduleName);
console.log('Variable import:', mod2.greet('Dynamic'));
`,
  },
  {
    name: 'JSON Import',
    category: 'edge',
    filename: '/tmp/test-json.js',
    code: `const fs = require('fs');

// Write a JSON file and require it
fs.mkdirSync('/tmp/json-test', { recursive: true });
fs.writeFileSync('/tmp/json-test/package.json', JSON.stringify({
  name: 'test-pkg',
  version: '1.0.0',
  dependencies: { lodash: '^4.0.0' },
}));

const pkg = require('/tmp/json-test/package.json');
console.log('Package name:', pkg.name);
console.log('Version:', pkg.version);
console.log('Deps:', pkg.dependencies);
console.log('Type:', typeof pkg);
`,
  },
  {
    name: 'Error Handling',
    category: 'edge',
    filename: '/tmp/test-errors.js',
    code: `const fs = require('fs');

// Test various error scenarios

// 1. File not found
try {
  fs.readFileSync('/nonexistent/file.txt');
} catch (e) {
  console.log('ENOENT:', e.code, '-', e.message);
}

// 2. Module not found
try {
  require('totally-nonexistent-module');
} catch (e) {
  console.log('Module not found:', e.message.slice(0, 60));
}

// 3. Syntax error in required module
fs.mkdirSync('/tmp/err-test', { recursive: true });
fs.writeFileSync('/tmp/err-test/bad.js', 'const x = {{{');
try {
  require('/tmp/err-test/bad.js');
} catch (e) {
  console.log('Syntax error caught:', e.constructor.name);
}

// 4. process.exit
console.log('\\nAbout to call process.exit(0)...');
process.exit(0);
console.log('This should not print');
`,
  },
  {
    name: 'Streams',
    category: 'edge',
    filename: '/tmp/test-streams.js',
    code: `const { Readable, Writable, Transform } = require('stream');

// Readable
const readable = new Readable({
  read() {
    this.push('chunk1\\n');
    this.push('chunk2\\n');
    this.push(null); // EOF
  }
});

// Transform (uppercase)
const upper = new Transform({
  transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  }
});

// Writable (collector)
const chunks = [];
const writable = new Writable({
  write(chunk, encoding, callback) {
    chunks.push(chunk.toString());
    callback();
  }
});

writable.on('finish', () => {
  console.log('Collected:', chunks.join(''));
});

readable.pipe(upper).pipe(writable);
`,
  },

  // ── Process (spawn/fork) ──
  {
    name: 'Spawn',
    category: 'compat',
    filename: '/tmp/test-spawn.mjs',
    code: `// Test child_process.spawn() — delegates to kernel syscalls
import { spawn } from 'child_process';

console.log('--- spawn: ls /home/user ---');
const ls = spawn('ls', ['-la', '/home/user']);

ls.stdout.on('data', (data) => {
  console.log('[stdout]', data);
});

ls.stderr.on('data', (data) => {
  console.error('[stderr]', data);
});

ls.on('exit', (code) => {
  console.log('ls exited with code', code);

  // Chain: spawn another command after the first finishes
  console.log('\\n--- spawn: cat /etc/hostname ---');
  const cat = spawn('cat', ['/etc/hostname']);

  cat.stdout.on('data', (data) => {
    console.log('[stdout]', data);
  });

  cat.on('exit', (code2) => {
    console.log('cat exited with code', code2);
  });
});
`,
  },
  {
    name: 'Fork',
    category: 'compat',
    filename: '/tmp/test-fork.mjs',
    code: `// Test child_process.fork() — spawns a long-running child process
// Run this, then open another tab and type "ps" to see both processes
import fs from 'fs';
import { fork, spawn } from 'child_process';

// Write a child script that runs for 30 seconds
fs.writeFileSync('/tmp/child-worker.mjs', \`
const label = process.argv[2] || 'worker';
const duration = parseInt(process.argv[3] || '30', 10);
console.log('[' + label + '] PID started, running for ' + duration + 's...');
console.log('[' + label + '] env.ROLE:', process.env.ROLE);

let tick = 0;
const iv = setInterval(() => {
  tick++;
  console.log('[' + label + '] tick ' + tick + '/' + duration);
  if (tick >= duration) {
    clearInterval(iv);
    console.log('[' + label + '] Done!');
  }
}, 1000);
\`);

console.log('[parent] Forking 2 child workers (30s each)...');
console.log('[parent] Run "ps" in another tab to see them!');
console.log('');

// Fork two children so ps shows multiple processes
const child1 = fork('/tmp/child-worker.mjs', ['alpha', '30'], {
  env: { ROLE: 'compute' },
});

const child2 = fork('/tmp/child-worker.mjs', ['beta', '30'], {
  env: { ROLE: 'io' },
});

// Also spawn a plain command that sleeps
const sleeper = spawn('sleep', ['25']);

child1.stdout.on('data', (d) => process.stdout.write(d));
child2.stdout.on('data', (d) => process.stdout.write(d));

let exited = 0;
function onExit(name) {
  return (code) => {
    console.log('[parent] ' + name + ' exited with code ' + code);
    exited++;
    if (exited >= 3) console.log('[parent] All children finished.');
  };
}
child1.on('exit', onExit('alpha'));
child2.on('exit', onExit('beta'));
sleeper.on('exit', onExit('sleeper'));
`,
  },
  {
    name: 'Exec',
    category: 'compat',
    filename: '/tmp/test-exec.mjs',
    code: `// Test child_process.exec() — run shell commands and capture output
import { exec } from 'child_process';

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('Error running:', cmd, err.message);
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

console.log('--- exec: echo hello ---');
const r1 = await run('echo hello world');
console.log('stdout:', JSON.stringify(r1.stdout));

console.log('\\n--- exec: ls / ---');
const r2 = await run('ls /');
console.log('stdout:', r2.stdout);

console.log('\\n--- exec: cat /etc/hostname ---');
const r3 = await run('cat /etc/hostname');
console.log('hostname:', r3.stdout.trim());

console.log('\\nAll exec tests passed!');
`,
  },
  {
    name: 'Spawn Pipeline',
    category: 'compat',
    filename: '/tmp/test-spawn-pipeline.mjs',
    code: `// Test spawning multiple processes in sequence (simulated pipeline)
import { spawn } from 'child_process';
import fs from 'fs';

// Write test data
fs.writeFileSync('/tmp/names.txt', \`Alice
Bob
Charlie
David
Eve
\`);

console.log('--- Spawn: cat /tmp/names.txt ---');

function collectOutput(proc) {
  return new Promise((resolve) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('exit', (code) => resolve({ out, code }));
  });
}

// Step 1: cat the file
const cat = spawn('cat', ['/tmp/names.txt']);
const result1 = await collectOutput(cat);
console.log('cat output:', result1.out);

// Step 2: count lines with wc
const wc = spawn('wc', ['-l', '/tmp/names.txt']);
const result2 = await collectOutput(wc);
console.log('wc output:', result2.out.trim());

console.log('\\nPipeline test done!');
`,
  },
];
