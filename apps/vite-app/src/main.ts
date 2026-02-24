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
<span class="code-comment">// Built-in git -- powered by isomorphic-git</span>
<span class="code-comment">// Works entirely in the browser VFS</span>

<span class="code-keyword">const</span> sandbox = <span class="code-keyword">await</span> Sandbox.<span class="code-fn">create</span>({
  <span class="code-const">terminal</span>: <span class="code-string">'#terminal'</span>,
})

<span class="code-comment">// Try these commands in the terminal:</span>

<span class="code-comment">// Initialize a repo</span>
<span class="code-string">mkdir /tmp/my-project && cd /tmp/my-project</span>
<span class="code-string">git init</span>

<span class="code-comment">// Create files and commit</span>
<span class="code-string">echo "# My App" > README.md</span>
<span class="code-string">git add .</span>
<span class="code-string">git commit -m "Initial commit"</span>

<span class="code-comment">// Branching</span>
<span class="code-string">git branch feature</span>
<span class="code-string">git checkout feature</span>
<span class="code-string">echo "new feature" > feature.js</span>
<span class="code-string">git add . && git commit -m "Add feature"</span>

<span class="code-comment">// Check status, log, diff</span>
<span class="code-string">git status</span>
<span class="code-string">git log --oneline</span>
<span class="code-string">git diff</span>

<span class="code-comment">// Or run the example script:</span>
<span class="code-string">source examples/scripts/13-git-basics.sh</span>`;

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
  cli: CODE_CLI,
};

// ─── State ───

type ExampleId = 'interactive' | 'headless' | 'multi' | 'http' | 'explorer' | 'git' | 'cli';

const examples: Record<ExampleId, { booted: boolean; boot: () => Promise<void> }> = {
  interactive: { booted: false, boot: bootInteractive },
  headless:    { booted: false, boot: bootHeadless },
  multi:       { booted: false, boot: bootMulti },
  http:        { booted: false, boot: bootHttp },
  explorer:    { booted: false, boot: bootExplorer },
  git:         { booted: false, boot: bootGit },
  cli:         { booted: false, boot: bootCli },
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
  if (id === 'cli') {
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
  registry.register('pkg', createPkgCommand(registry));
  loadInstalledPackages(kernel.vfs, registry);

  const env = kernel.getDefaultEnv();
  const shell = new Shell(terminal, kernel.vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

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
  registry.register('pkg', createPkgCommand(registry));
  loadInstalledPackages(kernel.vfs, registry);

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
  registry.register('pkg', createPkgCommand(registry));
  loadInstalledPackages(vfs, registry);

  const env = explorerKernel.getDefaultEnv();
  const shell = new Shell(terminal, vfs, registry, env);

  const jobTable = shell.getJobTable();
  registry.register('ps', createPsCommand(jobTable));
  registry.register('top', createTopCommand(jobTable));
  registry.register('kill', createKillCommand(jobTable));
  registry.register('watch', createWatchCommand(registry));
  registry.register('help', createHelpCommand(registry));

  await shell.sourceFile('/etc/profile');
  await shell.sourceFile(env.HOME + '/.bashrc');
  shell.start();
}

// ─── 6. Git ───

async function bootGit() {
  const sandbox = await Sandbox.create({
    terminal: '#terminal-git',
  });

  // Pre-run the git example setup so users see it in action
  await sandbox.commands.run('mkdir -p /tmp/my-project');
  await sandbox.commands.run('cd /tmp/my-project');
}

// ─── 7. CLI (Node.js) ───

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

// ─── Boot ───

// Show initial code
codeBlockEl.innerHTML = CODE_INTERACTIVE;

// Boot first example
examples.interactive.booted = true;
bootInteractive();
