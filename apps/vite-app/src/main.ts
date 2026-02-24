import './app.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal, FileExplorer } from '@lifo-sh/ui';
import type { EditorProvider, EditorInstance } from '@lifo-sh/ui';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(workerId: string, label: string): Worker;
    };
  }
}
import {
  Sandbox,
  Kernel,
  Shell,
  createDefaultRegistry,
  bootLifoPackages,
  createPsCommand,
  createTopCommand,
  createKillCommand,
  createWatchCommand,
  createHelpCommand,
  createNodeCommand,
  createCurlCommand,
  createNpmCommand,
  createLifoPkgCommand,
} from '@lifo-sh/core';
import gitCommand from 'lifo-pkg-git';
import ffmpegCommand from 'lifo-pkg-ffmpeg';

// ─── Code snippets for each example ───

const CODE_INTERACTIVE = `\
<span class="code-keyword">import</span> { Sandbox } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>
<span class="code-comment">// @lifo-sh/ui is auto-imported for visual mode</span>

<span class="code-comment">// One line to get a full interactive shell</span>
<span class="code-keyword">const</span> sandbox = <span class="code-keyword">await</span> Sandbox.<span class="code-fn">create</span>({
  <span class="code-const">persist</span>: <span class="code-keyword">true</span>,
  <span class="code-const">terminal</span>: <span class="code-string">'#terminal'</span>,
})

<span class="code-comment">// Interactive shell is running.</span>
<span class="code-comment">// Persistence keeps state across reloads.</span>
<span class="code-comment">// Low-level access:</span>
<span class="code-comment">//   sandbox.kernel</span>
<span class="code-comment">//   sandbox.shell</span>
<span class="code-comment">//   sandbox.cwd</span>
<span class="code-comment">//   sandbox.env</span>`;

const CODE_HEADLESS = `\
<span class="code-keyword">import</span> { Sandbox } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>

<span class="code-comment">// Create a headless sandbox (no terminal UI)</span>
<span class="code-keyword">const</span> sandbox = <span class="code-keyword">await</span> Sandbox.<span class="code-fn">create</span>()

<span class="code-comment">// Run commands programmatically</span>
<span class="code-keyword">const</span> r1 = <span class="code-keyword">await</span> sandbox.commands.<span class="code-fn">run</span>(
  <span class="code-string">'echo "Hello from Lifo!"'</span>
)
console.<span class="code-fn">log</span>(r1.stdout)   <span class="code-comment">// "Hello from Lifo!\\n"</span>
console.<span class="code-fn">log</span>(r1.exitCode) <span class="code-comment">// 0</span>

<span class="code-comment">// Write files and read them back</span>
<span class="code-keyword">await</span> sandbox.fs.<span class="code-fn">writeFile</span>(
  <span class="code-string">'/home/user/app.js'</span>,
  <span class="code-string">'console.log("hi")'</span>
)
<span class="code-keyword">const</span> content = <span class="code-keyword">await</span> sandbox.fs.<span class="code-fn">readFile</span>(
  <span class="code-string">'/home/user/app.js'</span>
)

<span class="code-comment">// Pipes, variable expansion</span>
<span class="code-keyword">await</span> sandbox.commands.<span class="code-fn">run</span>(<span class="code-string">'export GREETING=world'</span>)
<span class="code-keyword">const</span> r2 = <span class="code-keyword">await</span> sandbox.commands.<span class="code-fn">run</span>(
  <span class="code-string">'echo $GREETING | cat'</span>
)

<span class="code-comment">// List files</span>
<span class="code-keyword">const</span> entries = <span class="code-keyword">await</span> sandbox.fs.<span class="code-fn">readdir</span>(
  <span class="code-string">'/home/user'</span>
)

sandbox.<span class="code-fn">destroy</span>()`;

const CODE_MULTI = `\
<span class="code-keyword">import</span> { Terminal } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/ui'</span>
<span class="code-keyword">import</span> {
  Kernel, Shell,
  createDefaultRegistry, <span class="code-comment">...</span>
} <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>

<span class="code-comment">// Boot one shared kernel</span>
<span class="code-keyword">const</span> kernel = <span class="code-keyword">new</span> <span class="code-fn">Kernel</span>()
<span class="code-keyword">await</span> kernel.<span class="code-fn">boot</span>()

<span class="code-comment">// Helper: create an interactive shell</span>
<span class="code-comment">// that shares the kernel's VFS</span>
<span class="code-keyword">function</span> <span class="code-fn">createShell</span>(container) {
  <span class="code-keyword">const</span> term = <span class="code-keyword">new</span> <span class="code-fn">Terminal</span>(container)
  <span class="code-keyword">const</span> reg  = <span class="code-fn">createDefaultRegistry</span>()
  <span class="code-keyword">const</span> env  = kernel.<span class="code-fn">getDefaultEnv</span>()
  <span class="code-keyword">const</span> sh   = <span class="code-keyword">new</span> <span class="code-fn">Shell</span>(
    term, kernel.vfs, reg, env
  )
  sh.<span class="code-fn">start</span>()
  <span class="code-keyword">return</span> sh
}

<span class="code-comment">// Each tab creates a new Shell on</span>
<span class="code-comment">// the same VFS. Files created in one</span>
<span class="code-comment">// terminal are visible in all others.</span>
<span class="code-fn">createShell</span>(document.<span class="code-fn">getElementById</span>(<span class="code-string">'t1'</span>))
<span class="code-fn">createShell</span>(document.<span class="code-fn">getElementById</span>(<span class="code-string">'t2'</span>))

<span class="code-comment">// Try: "touch /tmp/shared" in tab 1,</span>
<span class="code-comment">// then "ls /tmp" in tab 2.</span>`;

const CODE_HTTP = `\
<span class="code-keyword">import</span> { Terminal } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/ui'</span>
<span class="code-keyword">import</span> {
  Kernel, Shell,
  createDefaultRegistry,
  createNodeCommand, createCurlCommand, <span class="code-comment">...</span>
} <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>

<span class="code-comment">// Boot kernel -- portRegistry is shared</span>
<span class="code-keyword">const</span> kernel = <span class="code-keyword">new</span> <span class="code-fn">Kernel</span>()
<span class="code-keyword">await</span> kernel.<span class="code-fn">boot</span>()

<span class="code-comment">// Write a server script to the VFS</span>
kernel.vfs.<span class="code-fn">writeFile</span>(<span class="code-string">'/home/user/server.js'</span>, \`
  <span class="code-keyword">const</span> http = <span class="code-fn">require</span>(<span class="code-string">'http'</span>)
  <span class="code-keyword">const</span> server = http.<span class="code-fn">createServer</span>((req, res) => {
    res.<span class="code-fn">writeHead</span>(<span class="code-const">200</span>, { <span class="code-string">'Content-Type'</span>: <span class="code-string">'text/plain'</span> })
    res.<span class="code-fn">end</span>(<span class="code-string">'Hello from Lifo!\\n'</span>)
  })
  server.<span class="code-fn">listen</span>(<span class="code-const">3000</span>, () => {
    console.<span class="code-fn">log</span>(<span class="code-string">'Server running on port 3000'</span>)
  })
\`)

<span class="code-comment">// Register node &amp; curl with portRegistry</span>
registry.<span class="code-fn">register</span>(<span class="code-string">'node'</span>,
  <span class="code-fn">createNodeCommand</span>(kernel.portRegistry))
registry.<span class="code-fn">register</span>(<span class="code-string">'curl'</span>,
  <span class="code-fn">createCurlCommand</span>(kernel.portRegistry))

<span class="code-comment">// Tab 1: node server.js</span>
<span class="code-comment">// Tab 2: curl localhost:3000</span>`;

const CODE_EXPLORER = `\
<span class="code-keyword">import</span> { Terminal, FileExplorer } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/ui'</span>
<span class="code-keyword">import</span> { Kernel, Shell, <span class="code-comment">...</span> } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>

<span class="code-keyword">const</span> kernel = <span class="code-keyword">new</span> <span class="code-fn">Kernel</span>()
<span class="code-keyword">await</span> kernel.<span class="code-fn">boot</span>()

<span class="code-comment">// File Explorer with Monaco editor</span>
<span class="code-keyword">const</span> explorer = <span class="code-keyword">new</span> <span class="code-fn">FileExplorer</span>(
  document.<span class="code-fn">getElementById</span>(<span class="code-string">'explorer'</span>),
  kernel.vfs,
  {
    <span class="code-const">cwd</span>: <span class="code-string">'/home/user'</span>,
    <span class="code-const">editorProvider</span>: monacoProvider,
  }
)

<span class="code-comment">// Terminal sharing the same VFS</span>
<span class="code-keyword">const</span> shell = <span class="code-keyword">new</span> <span class="code-fn">Shell</span>(
  term, kernel.vfs, registry, env
)
shell.<span class="code-fn">start</span>()

<span class="code-comment">// Changes sync live between</span>
<span class="code-comment">// terminal and explorer.</span>
<span class="code-comment">// Drag &amp; drop files to upload.</span>`;

const CODE_GIT = `\
<span class="code-keyword">import</span> { Kernel, Shell, createDefaultRegistry }
  <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>
<span class="code-keyword">import</span> gitCommand <span class="code-keyword">from</span> <span class="code-string">'lifo-pkg-git'</span>

<span class="code-comment">// Boot kernel + register git from package</span>
<span class="code-keyword">const</span> kernel = <span class="code-keyword">new</span> <span class="code-fn">Kernel</span>()
<span class="code-keyword">await</span> kernel.<span class="code-fn">boot</span>()

<span class="code-keyword">const</span> registry = <span class="code-fn">createDefaultRegistry</span>()
registry.<span class="code-fn">register</span>(<span class="code-string">'git'</span>, gitCommand)

<span class="code-comment">// Or install at runtime:</span>
<span class="code-comment">//   lifo install git</span>

<span class="code-comment">// Try these commands:</span>
<span class="code-string">mkdir /tmp/my-project && cd /tmp/my-project</span>
<span class="code-string">git init</span>
<span class="code-string">echo "# My App" > README.md</span>
<span class="code-string">git add .</span>
<span class="code-string">git commit -m "Initial commit"</span>
<span class="code-string">git branch feature</span>
<span class="code-string">git checkout feature</span>
<span class="code-string">echo "new feature" > feature.js</span>
<span class="code-string">git add . && git commit -m "Add feature"</span>
<span class="code-string">git log --oneline</span>`;

const CODE_NPM = `\
<span class="code-keyword">import</span> { Sandbox } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>

<span class="code-comment">// One line to get a shell with npm support</span>
<span class="code-keyword">const</span> sandbox = <span class="code-keyword">await</span> Sandbox.<span class="code-fn">create</span>({
  <span class="code-const">terminal</span>: <span class="code-string">'#terminal'</span>,
})

<span class="code-comment">// Try these in the terminal:</span>

<span class="code-comment">// Install a package globally</span>
<span class="code-string">npm install cowsay -g</span>

<span class="code-comment">// Run it!</span>
<span class="code-string">cowsay "Hello from Lifo!"</span>

<span class="code-comment">// Or create a project</span>
<span class="code-string">mkdir /tmp/my-app && cd /tmp/my-app</span>
<span class="code-string">npm init -y</span>
<span class="code-string">npm install cowsay</span>
<span class="code-string">cat node_modules/cowsay/package.json</span>

<span class="code-comment">// Packages are fetched from the real</span>
<span class="code-comment">// npm registry, extracted, and installed</span>
<span class="code-comment">// into the virtual filesystem.</span>
<span class="code-comment">// Dependencies are resolved recursively.</span>`;

const CODE_LIFO_PKG = `\
<span class="code-comment">// The lifo command manages packages</span>
<span class="code-comment">// that extend the OS with new commands</span>

<span class="code-comment">// Install a package (from npm: lifo-pkg-*)</span>
<span class="code-string">lifo install git</span>
<span class="code-string">lifo install ffmpeg</span>

<span class="code-comment">// Use it immediately</span>
<span class="code-string">git init</span>

<span class="code-comment">// List installed lifo packages</span>
<span class="code-string">lifo list</span>

<span class="code-comment">// Search npm for lifo packages</span>
<span class="code-string">lifo search postgres</span>

<span class="code-comment">// Remove a package</span>
<span class="code-string">lifo remove git</span>

<span class="code-comment">// How it works:</span>
<span class="code-comment">//   lifo install git</span>
<span class="code-comment">//   -> npm install -g lifo-pkg-git</span>
<span class="code-comment">//   -> reads "lifo" field from package.json</span>
<span class="code-comment">//   -> registers commands with lifo runtime</span>
<span class="code-comment">//</span>
<span class="code-comment">// Packages get access to:</span>
<span class="code-comment">//   ctx  - CommandContext (args, vfs, stdout...)</span>
<span class="code-comment">//   lifo - LifoAPI (import(), loadWasm()...)</span>

<span class="code-comment">// Configure CDN for ESM imports</span>
<span class="code-string">export LIFO_CDN=https://esm.sh</span>`;

const CODE_BUILD_PKG = `\
<span class="code-comment">// Create a new lifo package</span>
<span class="code-string">lifo init my-tool</span>
<span class="code-comment">// Creates:</span>
<span class="code-comment">//   my-tool/package.json     (with lifo field)</span>
<span class="code-comment">//   my-tool/commands/my-tool.js</span>
<span class="code-comment">//   my-tool/README.md</span>

<span class="code-comment">// The package.json lifo field:</span>
{
  <span class="code-string">"name"</span>: <span class="code-string">"lifo-pkg-my-tool"</span>,
  <span class="code-string">"lifo"</span>: {
    <span class="code-string">"commands"</span>: {
      <span class="code-string">"my-tool"</span>: <span class="code-string">"./commands/my-tool.js"</span>
    }
  }
}

<span class="code-comment">// Command entry (CJS module):</span>
module.exports = <span class="code-keyword">async function</span>(ctx, lifo) {
  <span class="code-comment">// ctx.args   - command arguments</span>
  <span class="code-comment">// ctx.vfs    - virtual filesystem</span>
  <span class="code-comment">// ctx.stdout - write output</span>
  <span class="code-comment">// ctx.stderr - write errors</span>
  <span class="code-comment">// ctx.cwd    - current directory</span>
  <span class="code-comment">// ctx.env    - environment variables</span>
  <span class="code-comment">// ctx.signal - AbortSignal</span>

  <span class="code-comment">// lifo.import() loads ESM from CDN</span>
  <span class="code-keyword">const</span> lib = <span class="code-keyword">await</span> lifo.<span class="code-fn">import</span>(<span class="code-string">'lodash-es'</span>)

  <span class="code-comment">// lifo.loadWasm() fetches + caches WASM</span>
  <span class="code-keyword">const</span> mod = <span class="code-keyword">await</span> lifo.<span class="code-fn">loadWasm</span>(url)

  ctx.stdout.<span class="code-fn">write</span>(<span class="code-string">'Hello!\\n'</span>)
  <span class="code-keyword">return</span> <span class="code-const">0</span>  <span class="code-comment">// exit code</span>
}

<span class="code-comment">// Dev workflow:</span>
<span class="code-string">lifo link ./my-tool</span>    <span class="code-comment"># register locally</span>
<span class="code-string">my-tool --help</span>         <span class="code-comment"># test it</span>
<span class="code-string">lifo unlink my-tool</span>    <span class="code-comment"># remove link</span>

<span class="code-comment">// Publish to npm:</span>
<span class="code-string">cd my-tool && npm publish</span>
<span class="code-comment">// Users install with: lifo install my-tool</span>`;

const CODE_CLI = `\
<span class="code-comment">// Run Lifo as a CLI in your terminal</span>
<span class="code-comment">// Install: npm i -g lifo-sh</span>

<span class="code-comment">// Temp session (files cleaned up on exit)</span>
$ <span class="code-fn">npx</span> <span class="code-string">lifo-sh</span>

<span class="code-comment">// Mount a host directory for real file I/O</span>
$ <span class="code-fn">npx</span> <span class="code-string">lifo-sh</span> <span class="code-keyword">--mount</span> <span class="code-string">~/projects/my-app</span>

<span class="code-comment">// Files are accessible at /mnt/host</span>
<span class="code-comment">// Your PWD starts there automatically</span>
user@lifo:/mnt/host$ <span class="code-fn">ls</span>
  package.json  src/  README.md

<span class="code-comment">// All changes go directly to disk</span>
user@lifo:/mnt/host$ <span class="code-fn">echo</span> <span class="code-string">"hello"</span> > test.txt
<span class="code-comment">// test.txt now exists on your real FS!</span>

<span class="code-comment">// Programmatic usage (Node.js)</span>
<span class="code-keyword">import</span> { Sandbox } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>
<span class="code-keyword">import</span> { NativeFsProvider } <span class="code-keyword">from</span> <span class="code-string">'@lifo-sh/core'</span>
<span class="code-keyword">import</span> * <span class="code-keyword">as</span> fs <span class="code-keyword">from</span> <span class="code-string">'node:fs'</span>

<span class="code-keyword">const</span> sandbox = <span class="code-keyword">await</span> Sandbox.<span class="code-fn">create</span>()

<span class="code-comment">// Mount your project directory</span>
<span class="code-keyword">const</span> provider = <span class="code-keyword">new</span> <span class="code-fn">NativeFsProvider</span>(
  <span class="code-string">'/home/user/project'</span>, fs
)
sandbox.kernel.vfs.<span class="code-fn">mount</span>(
  <span class="code-string">'/mnt/host'</span>, provider
)

<span class="code-comment">// Now VFS reads/writes hit real disk</span>
<span class="code-keyword">await</span> sandbox.commands.<span class="code-fn">run</span>(
  <span class="code-string">'ls /mnt/host'</span>
)`;

const codeSnippets: Record<string, string> = {
  interactive: CODE_INTERACTIVE,
  headless: CODE_HEADLESS,
  multi: CODE_MULTI,
  http: CODE_HTTP,
  explorer: CODE_EXPLORER,
  git: CODE_GIT,
  npm: CODE_NPM,
  cli: CODE_CLI,
  'lifo-pkg': CODE_LIFO_PKG,
  'build-pkg': CODE_BUILD_PKG,
};

// ─── State ───

type ExampleId = 'interactive' | 'headless' | 'multi' | 'http' | 'explorer' | 'git' | 'npm' | 'cli' | 'lifo-pkg' | 'build-pkg';

const examples: Record<ExampleId, { booted: boolean; boot: () => Promise<void> }> = {
  interactive:  { booted: false, boot: bootInteractive },
  headless:     { booted: false, boot: bootHeadless },
  multi:        { booted: false, boot: bootMulti },
  http:         { booted: false, boot: bootHttp },
  explorer:     { booted: false, boot: bootExplorer },
  git:          { booted: false, boot: bootGit },
  npm:          { booted: false, boot: bootNpm },
  cli:          { booted: false, boot: bootCli },
  'lifo-pkg':   { booted: false, boot: bootLifoPkg },
  'build-pkg':  { booted: false, boot: bootBuildPkg },
};

let activeExample: ExampleId = 'interactive';

// ─── Mobile toggle helpers ───

const sidebar = document.getElementById('sidebar')!;
const sidebarBackdrop = document.getElementById('sidebar-backdrop')!;
const sidebarToggle = document.getElementById('sidebar-toggle')!;
const colCode = document.getElementById('col-code')!;
const codeToggle = document.getElementById('code-toggle')!;

function openSidebar() {
  sidebar.classList.remove('-translate-x-full');
  sidebar.classList.add('translate-x-0');
  sidebarBackdrop.classList.remove('hidden');
}

function closeSidebar() {
  sidebar.classList.add('-translate-x-full');
  sidebar.classList.remove('translate-x-0');
  sidebarBackdrop.classList.add('hidden');
}

sidebarToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.contains('translate-x-0');
  if (isOpen) closeSidebar();
  else openSidebar();
});

sidebarBackdrop.addEventListener('click', closeSidebar);

codeToggle.addEventListener('click', () => {
  const isVisible = colCode.classList.contains('flex');
  if (isVisible) {
    colCode.classList.remove('flex');
    colCode.classList.add('hidden');
  } else {
    colCode.classList.remove('hidden');
    colCode.classList.add('flex');
  }
});

// ─── Navigation ───

const codeBlockEl = document.getElementById('code-block')!;

document.querySelectorAll<HTMLButtonElement>('.sidebar-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.example as ExampleId;
    if (id === activeExample) return;
    switchExample(id);
  });
});

function switchExample(id: ExampleId) {
  // Sidebar
  document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
  document.querySelector(`[data-example="${id}"]`)?.classList.add('active');

  // Code column -- hide for examples that don't need it
  if (id === 'cli' || id === 'lifo-pkg' || id === 'build-pkg') {
    colCode.classList.remove('lg:flex');
    colCode.classList.add('lg:hidden');
  } else {
    colCode.classList.remove('lg:hidden');
    colCode.classList.add('lg:flex');
    codeBlockEl.innerHTML = codeSnippets[id];
  }

  // Output column
  document.querySelectorAll('.output-panel').forEach((el) => el.classList.remove('active'));
  document.getElementById(`out-${id}`)?.classList.add('active');

  activeExample = id;

  // Close sidebar on mobile after selecting
  closeSidebar();

  // Lazy-boot
  const ex = examples[id];
  if (!ex.booted) {
    ex.booted = true;
    ex.boot();
  }
}

// ─── 1. Interactive Shell ───

async function bootInteractive() {
  await Sandbox.create({
    persist: true,
    terminal: '#terminal-interactive',
  });
}

// ─── 2. Headless / AI Agent ───

let headlessSandbox: Sandbox | null = null;

async function bootHeadless() {
  document.getElementById('headless-run')!.addEventListener('click', runHeadlessExample);
}

async function runHeadlessExample() {
  const outputEl = document.getElementById('headless-output')!;
  const runBtn = document.getElementById('headless-run') as HTMLButtonElement;

  runBtn.disabled = true;
  outputEl.textContent = 'Running...\n';
  headlessSandbox?.destroy();

  try {
    const log = (text: string) => { outputEl.textContent += text; };

    log('> Creating sandbox...\n');
    headlessSandbox = await Sandbox.create();
    log('  Sandbox ready. cwd = ' + headlessSandbox.cwd + '\n\n');

    log('> sandbox.commands.run(\'echo "Hello from Lifo!"\')\n');
    const r1 = await headlessSandbox.commands.run('echo "Hello from Lifo!"');
    log('  stdout: ' + JSON.stringify(r1.stdout) + '\n');
    log('  exitCode: ' + r1.exitCode + '\n\n');

    log('> sandbox.fs.writeFile(\'/home/user/app.js\', ...)\n');
    await headlessSandbox.fs.writeFile('/home/user/app.js', 'console.log("hi")');
    log('  Done.\n\n');

    log('> sandbox.fs.readFile(\'/home/user/app.js\')\n');
    const content = await headlessSandbox.fs.readFile('/home/user/app.js');
    log('  content: ' + JSON.stringify(content) + '\n\n');

    log('> sandbox.commands.run(\'export GREETING=world\')\n');
    await headlessSandbox.commands.run('export GREETING=world');
    log('  Done.\n\n');

    log('> sandbox.commands.run(\'echo $GREETING | cat\')\n');
    const r2 = await headlessSandbox.commands.run('echo $GREETING | cat');
    log('  stdout: ' + JSON.stringify(r2.stdout) + '\n\n');

    log('> sandbox.fs.readdir(\'/home/user\')\n');
    const entries = await headlessSandbox.fs.readdir('/home/user');
    for (const e of entries) {
      log('  ' + (e.type === 'directory' ? '/' : ' ') + e.name + '\n');
    }
    log('\n');

    log('> sandbox.destroy()\n');
    headlessSandbox.destroy();
    headlessSandbox = null;
    log('  Done. All resources released.\n');
  } catch (e) {
    outputEl.textContent += '\nError: ' + (e instanceof Error ? e.message : String(e)) + '\n';
  } finally {
    runBtn.disabled = false;
  }
}

// ─── 3. Multi Terminal (tabbed, shared kernel) ───

let multiKernel: Kernel | null = null;

interface MultiTab {
  id: number;
  tabBtn: HTMLButtonElement;
  panel: HTMLDivElement;
  terminal: Terminal;
  shell: Shell;
}

let multiTabs: MultiTab[] = [];
let multiActiveTabId = -1;
let multiNextId = 1;

async function bootMulti() {
  multiKernel = new Kernel();
  await multiKernel.boot({ persist: false });

  await addMultiTab();
  await addMultiTab();

  document.getElementById('multi-add-tab')!.addEventListener('click', () => {
    addMultiTab();
  });
}

async function addMultiTab(): Promise<MultiTab> {
  const kernel = multiKernel!;
  const id = multiNextId++;

  const tabBar = document.getElementById('multi-tab-bar')!;
  const addBtn = document.getElementById('multi-add-tab')!;
  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn px-3.5 py-[5px] bg-transparent border-none text-tokyo-comment text-xs font-medium cursor-pointer rounded-t-[5px] transition-colors whitespace-nowrap hover:text-tokyo-muted hover:bg-tokyo-hover';
  tabBtn.textContent = `Terminal ${id}`;
  tabBtn.addEventListener('click', () => switchMultiTab(id));
  tabBar.insertBefore(tabBtn, addBtn);

  const panels = document.getElementById('multi-tab-panels')!;
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  const container = document.createElement('div');
  container.className = 'w-full h-full';
  panel.appendChild(container);
  panels.appendChild(panel);

  const terminal = new Terminal(container);
  const registry = createDefaultRegistry();
  bootLifoPackages(kernel.vfs, registry);

  const env = kernel.getDefaultEnv();
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

  const multiNpmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm', createNpmCommand(registry, multiNpmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, multiNpmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');
  shell.start();

  const tab: MultiTab = { id, tabBtn, panel, terminal, shell };
  multiTabs.push(tab);
  switchMultiTab(id);

  return tab;
}

function switchMultiTab(id: number) {
  if (id === multiActiveTabId) return;
  multiActiveTabId = id;

  for (const tab of multiTabs) {
    const isActive = tab.id === id;
    tab.tabBtn.classList.toggle('active', isActive);
    tab.panel.classList.toggle('active', isActive);
    if (isActive) tab.terminal.focus();
  }
}

// ─── 4. HTTP Server (tabbed, shared kernel with virtual ports) ───

let httpKernel: Kernel | null = null;

interface HttpTab {
  id: string;
  tabBtn: HTMLButtonElement;
  panel: HTMLDivElement;
  terminal: Terminal;
  shell: Shell;
}

let httpTabs: HttpTab[] = [];
let httpActiveTabId = '';

async function bootHttp() {
  httpKernel = new Kernel();
  await httpKernel.boot({ persist: false });

  // Write server.js to VFS
  httpKernel.vfs.writeFile('/home/user/server.js', `const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from Lifo!\\n');
});
server.listen(3000, () => {
  console.log('Server running on port 3000');
});
`);

  await addHttpTab('Server');
  await addHttpTab('Client');
}

async function addHttpTab(label: string): Promise<HttpTab> {
  const kernel = httpKernel!;
  const id = label.toLowerCase();

  const tabBar = document.getElementById('http-tab-bar')!;
  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn px-3.5 py-[5px] bg-transparent border-none text-tokyo-comment text-xs font-medium cursor-pointer rounded-t-[5px] transition-colors whitespace-nowrap hover:text-tokyo-muted hover:bg-tokyo-hover';
  tabBtn.textContent = label;
  tabBtn.addEventListener('click', () => switchHttpTab(id));
  tabBar.appendChild(tabBtn);

  const panels = document.getElementById('http-tab-panels')!;
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  const container = document.createElement('div');
  container.className = 'w-full h-full';
  panel.appendChild(container);
  panels.appendChild(panel);

  const terminal = new Terminal(container);
  const registry = createDefaultRegistry();
  bootLifoPackages(kernel.vfs, registry);

  // Register node and curl with the shared portRegistry
  registry.register('node', createNodeCommand(kernel.portRegistry));
  registry.register('curl', createCurlCommand(kernel.portRegistry));

  const env = kernel.getDefaultEnv();
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

  const httpNpmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm', createNpmCommand(registry, httpNpmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, httpNpmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');
  shell.start();

  const tab: HttpTab = { id, tabBtn, panel, terminal, shell };
  httpTabs.push(tab);
  switchHttpTab(id);

  return tab;
}

function switchHttpTab(id: string) {
  if (id === httpActiveTabId) return;
  httpActiveTabId = id;

  for (const tab of httpTabs) {
    const isActive = tab.id === id;
    tab.tabBtn.classList.toggle('active', isActive);
    tab.panel.classList.toggle('active', isActive);
    if (isActive) tab.terminal.focus();
  }
}

// ─── 5. File Explorer (split pane: explorer + terminal) ───

let explorerKernel: Kernel | null = null;

function createMonacoProvider(): EditorProvider {
  return {
    create(container: HTMLElement, content: string, language: string): EditorInstance {
      // Lazy-load Monaco
      let editor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;
      let disposed = false;
      const changeCallbacks: (() => void)[] = [];

      import('monaco-editor').then((monaco) => {
        if (disposed) return;

        // Configure Monaco workers
        window.MonacoEnvironment = {
          getWorker(_workerId: string, label: string) {
            if (label === 'json') {
              return new Worker(
                new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
                { type: 'module' },
              );
            }
            if (label === 'css' || label === 'scss' || label === 'less') {
              return new Worker(
                new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
                { type: 'module' },
              );
            }
            if (label === 'html' || label === 'handlebars' || label === 'razor') {
              return new Worker(
                new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
                { type: 'module' },
              );
            }
            if (label === 'typescript' || label === 'javascript') {
              return new Worker(
                new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
                { type: 'module' },
              );
            }
            return new Worker(
              new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
              { type: 'module' },
            );
          },
        };

        // Define Tokyo Night theme
        monaco.editor.defineTheme('tokyo-night', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'bb9af7' },
            { token: 'string', foreground: '9ece6a' },
            { token: 'number', foreground: 'ff9e64' },
            { token: 'type', foreground: '2ac3de' },
            { token: 'identifier', foreground: 'c0caf5' },
            { token: 'delimiter', foreground: '89ddff' },
          ],
          colors: {
            'editor.background': '#1a1b26',
            'editor.foreground': '#a9b1d6',
            'editor.selectionBackground': '#33467c',
            'editor.lineHighlightBackground': '#1e2030',
            'editorCursor.foreground': '#c0caf5',
            'editorLineNumber.foreground': '#3b4261',
            'editorLineNumber.activeForeground': '#737aa2',
          },
        });

        editor = monaco.editor.create(container, {
          value: content,
          language,
          theme: 'tokyo-night',
          fontSize: 13,
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
          renderLineHighlight: 'line',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
        });

        editor.onDidChangeModelContent(() => {
          for (const cb of changeCallbacks) cb();
        });
      });

      return {
        getValue(): string {
          return editor?.getValue() ?? content;
        },
        onDidChangeContent(callback: () => void): void {
          changeCallbacks.push(callback);
        },
        dispose(): void {
          disposed = true;
          editor?.dispose();
          editor = null;
        },
      };
    },
  };
}

async function bootExplorer() {
  explorerKernel = new Kernel();
  await explorerKernel.boot({ persist: false });

  // Create some sample files so the explorer isn't empty
  const vfs = explorerKernel.vfs;
  vfs.mkdir('/home/user/projects', { recursive: true });
  vfs.mkdir('/home/user/projects/my-app/src', { recursive: true });
  vfs.writeFile('/home/user/projects/my-app/package.json', JSON.stringify({ name: 'my-app', version: '1.0.0' }, null, 2));
  vfs.writeFile('/home/user/projects/my-app/src/index.ts', 'console.log("Hello from my-app!");\n');
  vfs.writeFile('/home/user/projects/my-app/src/utils.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
  vfs.writeFile('/home/user/projects/my-app/README.md', '# My App\n\nA sample project.\n');
  vfs.mkdir('/home/user/notes');
  vfs.writeFile('/home/user/notes/todo.txt', '- Try the file explorer\n- Edit some files\n- Create new folders\n');
  vfs.writeFile('/home/user/hello.sh', '#!/bin/sh\necho "Hello, world!"\n');

  // Mount file explorer with Monaco editor
  const explorerContainer = document.getElementById('explorer-panel')!;
  new FileExplorer(explorerContainer, vfs, {
    cwd: '/home/user',
    editorProvider: createMonacoProvider(),
  });

  // Mount terminal sharing the same kernel
  const termContainer = document.getElementById('explorer-terminal')!;
  const terminal = new Terminal(termContainer);
  const registry = createDefaultRegistry();
  bootLifoPackages(vfs, registry);

  const env = explorerKernel.getDefaultEnv();
  const shell = new Shell(terminal, vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

  const explorerNpmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm', createNpmCommand(registry, explorerNpmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, explorerNpmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');
  shell.start();
}

// ─── 6. Git (via lifo-pkg-git) ───

async function bootGit() {
  const kernel = new Kernel();
  await kernel.boot({ persist: false });

  const container = document.getElementById('terminal-git')!;
  const terminal = new Terminal(container);

  const registry = createDefaultRegistry();
  registry.register('git', gitCommand);      // register from lifo-pkg-git
  registry.register('ffmpeg', ffmpegCommand); // register from lifo-pkg-ffmpeg
  bootLifoPackages(kernel.vfs, registry);

  const env = kernel.getDefaultEnv();
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

  // Register npm + lifo commands
  const npmShellExecute = async (cmd: string, cmdCtx: { cwd: string; env: Record<string, string>; stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } }) => {
    const result = await shell.execute(cmd, {
      cwd: cmdCtx.cwd,
      env: cmdCtx.env,
      onStdout: (data: string) => cmdCtx.stdout.write(data),
      onStderr: (data: string) => cmdCtx.stderr.write(data),
    });
    return result.exitCode;
  };
  registry.register('npm', createNpmCommand(registry, npmShellExecute));
  registry.register('lifo', createLifoPkgCommand(registry, npmShellExecute));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');
  shell.start();
}

// ─── 7. npm ───

async function bootNpm() {
  await Sandbox.create({
    terminal: '#terminal-npm',
  });
}

// ─── 8. CLI (Node.js) ───

async function bootCli() {
  const outputEl = document.getElementById('cli-output')!;

  outputEl.innerHTML = `\
<span style="color:#7aa2f7;font-weight:bold">Lifo CLI</span> <span style="color:#565f89">-- run a Linux-like shell in your terminal</span>

<span style="color:#bb9af7">Install:</span>
  <span style="color:#9ece6a">npm install -g lifo-sh</span>

<span style="color:#bb9af7">Usage:</span>

  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo-sh</span>
  <span style="color:#565f89">  Starts a temp session. Files are stored in a temporary</span>
  <span style="color:#565f89">  directory and cleaned up when you exit.</span>

  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo-sh</span> <span style="color:#ff9e64">--mount</span> <span style="color:#9ece6a">~/projects/my-app</span>
  <span style="color:#565f89">  Mounts a host directory at /mnt/host. Your PWD starts</span>
  <span style="color:#565f89">  there. All file operations go directly to disk via</span>
  <span style="color:#565f89">  NativeFsProvider -- no memory limits on file size.</span>

  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo-sh</span> <span style="color:#ff9e64">-m</span> <span style="color:#9ece6a">/tmp</span>
  <span style="color:#565f89">  Short form of --mount.</span>

<span style="color:#bb9af7">What you get:</span>
  <span style="color:#9ece6a">60+</span> built-in commands (ls, grep, git, node, curl...)
  Shell scripting (if/for/while/case/functions/pipes)
  Node.js compatibility (require, fs, path, http...)
  <span style="color:#9ece6a">Real filesystem</span> access via --mount

<span style="color:#bb9af7">Example session:</span>
<span style="color:#3b4261">  ┌─────────────────────────────────────────────┐</span>
<span style="color:#3b4261">  │</span> <span style="color:#c0caf5">$ npx lifo-sh --mount ~/projects/my-app</span>     <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>                                              <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#565f89">Mounted: ~/projects/my-app -> /mnt/host</span>     <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#9ece6a">user@lifo</span>:<span style="color:#7aa2f7">/mnt/host</span>$ ls                     <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   package.json  src/  README.md              <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#9ece6a">user@lifo</span>:<span style="color:#7aa2f7">/mnt/host</span>$ cat package.json       <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   { "name": "my-app", ... }                  <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#9ece6a">user@lifo</span>:<span style="color:#7aa2f7">/mnt/host</span>$ echo "test" > new.txt  <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#9ece6a">user@lifo</span>:<span style="color:#7aa2f7">/mnt/host</span>$ exit                  <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> logout                                       <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>                                              <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> <span style="color:#c0caf5">$ cat ~/projects/my-app/new.txt</span>             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span> test  <span style="color:#565f89"># file persisted to real disk!</span>        <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  └─────────────────────────────────────────────┘</span>

<span style="color:#bb9af7">Programmatic mounting (Node.js API):</span>
<span style="color:#565f89">  import { Sandbox, NativeFsProvider } from '@lifo-sh/core'</span>
<span style="color:#565f89">  import * as fs from 'node:fs'</span>
<span style="color:#565f89"></span>
<span style="color:#565f89">  const sandbox = await Sandbox.create()</span>
<span style="color:#565f89">  const provider = new NativeFsProvider('/my/dir', fs)</span>
<span style="color:#565f89">  sandbox.kernel.vfs.mount('/mnt/host', provider)</span>`;
}

// ─── 9. Lifo Package Manager (docs) ───

async function bootLifoPkg() {
  const el = document.getElementById('lifo-pkg-output')!;
  el.innerHTML = `\
<span style="color:#7aa2f7;font-weight:bold">lifo</span> <span style="color:#565f89">-- Lifo Package Manager</span>

<span style="color:#bb9af7">Overview:</span>
  The <span style="color:#7aa2f7">lifo</span> command installs packages that extend
  the OS with new commands. Packages live on npm
  with the prefix <span style="color:#9ece6a">lifo-pkg-*</span>.

<span style="color:#bb9af7">Install a package:</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo install</span> <span style="color:#9ece6a">git</span>
  <span style="color:#565f89">  Resolves to npm package: lifo-pkg-git</span>
  <span style="color:#565f89">  Downloads, extracts, and registers commands</span>

<span style="color:#bb9af7">What happens under the hood:</span>
<span style="color:#3b4261">  ┌──────────────────────────────────────────────┐</span>
<span style="color:#3b4261">  │</span> <span style="color:#c0caf5">lifo install git</span>                             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   <span style="color:#565f89">1. Runs:</span> npm install -g lifo-pkg-git        <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   <span style="color:#565f89">2. Reads "lifo" field from package.json</span>      <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   <span style="color:#565f89">3. Registers commands with lifo runtime</span>      <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>   <span style="color:#565f89">4. Command available immediately</span>             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  └──────────────────────────────────────────────┘</span>

<span style="color:#bb9af7">Commands:</span>
  <span style="color:#7aa2f7">lifo install</span> <span style="color:#9ece6a">&lt;name&gt;</span>     Install lifo-pkg-&lt;name&gt; from npm
  <span style="color:#7aa2f7">lifo remove</span> <span style="color:#9ece6a">&lt;name&gt;</span>      Remove a package
  <span style="color:#7aa2f7">lifo list</span>               List installed packages + dev links
  <span style="color:#7aa2f7">lifo search</span> <span style="color:#9ece6a">&lt;term&gt;</span>      Search npm for lifo-pkg-* packages
  <span style="color:#7aa2f7">lifo init</span> <span style="color:#9ece6a">&lt;name&gt;</span>        Scaffold a new package
  <span style="color:#7aa2f7">lifo link</span> <span style="color:#9ece6a">[path]</span>        Dev-link a local package
  <span style="color:#7aa2f7">lifo unlink</span> <span style="color:#9ece6a">&lt;name&gt;</span>      Remove a dev link

<span style="color:#bb9af7">Lifo Runtime API:</span>
  <span style="color:#565f89">Lifo packages get an enhanced runtime with:</span>

  <span style="color:#7aa2f7">lifo.import</span>(specifier)    Import ESM from CDN
  <span style="color:#7aa2f7">lifo.loadWasm</span>(url)        Fetch + cache WASM modules
  <span style="color:#7aa2f7">lifo.resolve</span>(path)        Resolve path relative to cwd
  <span style="color:#7aa2f7">lifo.cdn</span>                  Current CDN URL

<span style="color:#bb9af7">Configuration:</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">export</span> LIFO_CDN=<span style="color:#9ece6a">https://esm.sh</span>  <span style="color:#565f89">(default)</span>
  <span style="color:#565f89">  Configure which CDN is used for lifo.import()</span>

<span style="color:#bb9af7">npm still works unchanged:</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">npm install -g</span> <span style="color:#9ece6a">cowsay</span>  <span style="color:#565f89">  Pure JS packages</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo install</span> <span style="color:#9ece6a">git</span>       <span style="color:#565f89">  Lifo-native packages</span>`;
}

// ─── 10. Build Lifo Packages (docs) ───

async function bootBuildPkg() {
  const el = document.getElementById('build-pkg-output')!;
  el.innerHTML = `\
<span style="color:#7aa2f7;font-weight:bold">Building Lifo Packages</span>

<span style="color:#bb9af7">Create a package (on your host machine):</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">npm create lifo-pkg</span> <span style="color:#9ece6a">my-tool</span>

  <span style="color:#565f89">Scaffolds a full TypeScript project:</span>
    lifo-pkg-my-tool/
      src/index.ts              <span style="color:#565f89"># command source (TypeScript)</span>
      example/                  <span style="color:#565f89"># Vite app for browser testing</span>
        index.html
        main.ts                 <span style="color:#565f89"># boots Kernel + Shell + your command</span>
      test-cli.js               <span style="color:#565f89"># CLI test harness (Node.js)</span>
      vite.config.ts            <span style="color:#565f89"># build config</span>
      package.json              <span style="color:#565f89"># with "lifo" field</span>

<span style="color:#bb9af7">Or quick-start inside the Lifo sandbox:</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo init</span> <span style="color:#9ece6a">my-tool</span>           <span style="color:#565f89"># CJS scaffold for dev-link</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo link</span> <span style="color:#9ece6a">./my-tool</span>         <span style="color:#565f89"># register locally</span>
  <span style="color:#c0caf5">$ </span>my-tool --help               <span style="color:#565f89"># test immediately</span>

<span style="color:#bb9af7">The "lifo" field in package.json:</span>
<span style="color:#3b4261">  ┌──────────────────────────────────────────────┐</span>
<span style="color:#3b4261">  │</span>  {                                             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    <span style="color:#7aa2f7">"name"</span>: <span style="color:#9ece6a">"lifo-pkg-my-tool"</span>,                <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    <span style="color:#7aa2f7">"lifo"</span>: {                                  <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>      <span style="color:#7aa2f7">"commands"</span>: {                             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>        <span style="color:#7aa2f7">"my-tool"</span>: <span style="color:#9ece6a">"./dist/index.js"</span>           <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>      }                                         <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    }                                            <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>  }                                              <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  └──────────────────────────────────────────────┘</span>

  <span style="color:#565f89">Any npm package with a "lifo" field and the</span>
  <span style="color:#565f89">prefix lifo-pkg-* is a lifo package.</span>

<span style="color:#bb9af7">Command source (TypeScript):</span>
<span style="color:#3b4261">  ┌──────────────────────────────────────────────┐</span>
<span style="color:#3b4261">  │</span>  <span style="color:#c0caf5">import type</span> { Command } <span style="color:#c0caf5">from</span> <span style="color:#9ece6a">'@lifo-sh/core'</span> <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>                                               <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>  <span style="color:#c0caf5">const</span> cmd: Command = <span style="color:#c0caf5">async</span> (ctx) => {        <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    ctx.stdout.write(<span style="color:#9ece6a">'Hello!\\n'</span>)               <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    <span style="color:#c0caf5">return</span> 0                                   <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>  }                                             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>  <span style="color:#c0caf5">export default</span> cmd                            <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  └──────────────────────────────────────────────┘</span>

<span style="color:#bb9af7">Or CJS (for lifo init / dev-link):</span>
<span style="color:#3b4261">  ┌──────────────────────────────────────────────┐</span>
<span style="color:#3b4261">  │</span>  module.exports = async function(ctx, lifo) { <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    <span style="color:#565f89">// lifo.import(), lifo.loadWasm()</span>          <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    ctx.stdout.write(<span style="color:#9ece6a">'Hello!\\n'</span>)               <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>    return 0                                    <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  │</span>  }                                             <span style="color:#3b4261">│</span>
<span style="color:#3b4261">  └──────────────────────────────────────────────┘</span>

<span style="color:#bb9af7">Testing your package:</span>

  <span style="color:#9ece6a">Browser</span> <span style="color:#565f89">(example Vite app included in scaffold)</span>
  <span style="color:#c0caf5">$ </span>npm run build
  <span style="color:#c0caf5">$ </span>npm run test:browser       <span style="color:#565f89"># opens terminal at localhost</span>

  <span style="color:#9ece6a">CLI</span> <span style="color:#565f89">(headless, no browser needed)</span>
  <span style="color:#c0caf5">$ </span>npm run test:cli -- --help <span style="color:#565f89"># runs command directly</span>

  <span style="color:#9ece6a">Dev-link</span> <span style="color:#565f89">(inside a running Lifo sandbox)</span>
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo link</span> <span style="color:#9ece6a">./my-tool</span>
  <span style="color:#c0caf5">$ </span>my-tool --help

<span style="color:#bb9af7">Using lifo.import() for dependencies:</span>
  <span style="color:#565f89">Load any npm package as ESM from CDN at runtime.</span>

  <span style="color:#c0caf5">const</span> { FFmpeg } = await lifo.<span style="color:#7aa2f7">import</span>(<span style="color:#9ece6a">'@ffmpeg/ffmpeg'</span>)
  <span style="color:#c0caf5">const</span> _ = await lifo.<span style="color:#7aa2f7">import</span>(<span style="color:#9ece6a">'lodash-es'</span>)

<span style="color:#bb9af7">Using lifo.loadWasm() for WASM:</span>
  <span style="color:#c0caf5">const</span> mod = await lifo.<span style="color:#7aa2f7">loadWasm</span>(<span style="color:#9ece6a">'https://...'</span>)
  <span style="color:#c0caf5">const</span> instance = await WebAssembly.<span style="color:#7aa2f7">instantiate</span>(mod)

<span style="color:#bb9af7">Publishing:</span>
  <span style="color:#c0caf5">$ </span>cd lifo-pkg-my-tool
  <span style="color:#c0caf5">$ </span>npm run build
  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">npm publish</span>

  <span style="color:#565f89">Users install with:</span>  <span style="color:#c0caf5">$ </span><span style="color:#7aa2f7">lifo install</span> <span style="color:#9ece6a">my-tool</span>

<span style="color:#bb9af7">Example: lifo-pkg-git</span>
  <span style="color:#565f89">Real-world lifo package powering the git command:</span>
  <span style="color:#565f89">  - TypeScript, exports Command type from @lifo-sh/core</span>
  <span style="color:#565f89">  - Depends on isomorphic-git</span>
  <span style="color:#565f89">  - Install: lifo install git</span>
  <span style="color:#565f89">  - Or import: import gitCommand from 'lifo-pkg-git'</span>`;
}

// ─── Boot ───

// Show initial code
codeBlockEl.innerHTML = CODE_INTERACTIVE;

// Boot first example
examples.interactive.booted = true;
bootInteractive();
