import './style.css';
import { Terminal } from '@lifo-sh/ui';
import {
  Kernel,
  Shell,
  createDefaultRegistry,
  createProcessExecutor,
  bootLifoPackages,
  createNodeCommand,
  createNpmCommand,
  createNpxCommand,
  createPsCommand,
  createTopCommand,
  createKillCommand,
  createCurlCommand,
} from '@lifo-sh/core';
import { presets } from './presets';
import { initVfsInspector, setLoadFileCallback, refresh as refreshVfs } from './vfs-inspector';

// ── DOM refs ──

const terminalContainer = document.getElementById('terminal-container')!;
const statusBadge = document.getElementById('status')!;
const workerToggle = document.getElementById('worker-toggle') as HTMLInputElement;
const persistToggle = document.getElementById('persist-toggle') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn')!;
const resetVfsBtn = document.getElementById('reset-vfs-btn')!;
const codeEditor = document.getElementById('code-editor') as HTMLTextAreaElement;
const filenameInput = document.getElementById('filename-input') as HTMLInputElement;
const runBtn = document.getElementById('run-btn')!;
const saveBtn = document.getElementById('save-btn')!;
const presetButtonsContainer = document.getElementById('preset-buttons')!;
const resizer = document.getElementById('resizer')!;
const editorPanel = document.getElementById('editor-panel')!;

// ── Status helpers ──

function setStatus(state: 'loading' | 'ready' | 'error', text: string) {
  statusBadge.className = `status-badge ${state}`;
  statusBadge.textContent = text;
}

// ── Preferences ──

const WORKER_KEY = 'node-runner:worker';
const PERSIST_KEY = 'node-runner:persist';

function getWorkerPref(): boolean {
  const stored = localStorage.getItem(WORKER_KEY);
  return stored === null ? true : stored === '1';
}

function getPersistPref(): boolean {
  const stored = localStorage.getItem(PERSIST_KEY);
  return stored === null ? true : stored === '1';
}

workerToggle.checked = getWorkerPref();
persistToggle.checked = getPersistPref();

// ── Presets ──

function loadPreset(preset: typeof presets[number]) {
  codeEditor.value = preset.code;
  filenameInput.value = preset.filename;
}

for (const preset of presets) {
  const btn = document.createElement('button');
  btn.className = 'preset-btn';
  btn.dataset.category = preset.category;
  btn.textContent = preset.name;
  btn.addEventListener('click', () => loadPreset(preset));
  presetButtonsContainer.appendChild(btn);
}

// Load first preset by default
if (presets.length > 0) {
  loadPreset(presets[0]);
}

// ── Resizer (drag to resize panels) ──

let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('active');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const containerRect = editorPanel.parentElement!.getBoundingClientRect();
  const newWidth = e.clientX - containerRect.left;
  const pct = (newWidth / containerRect.width) * 100;
  if (pct > 15 && pct < 85) {
    editorPanel.style.width = `${pct}%`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('active');
  }
});

// ── Tab key in editor ──

codeEditor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = codeEditor.selectionStart;
    const end = codeEditor.selectionEnd;
    codeEditor.value = codeEditor.value.substring(0, start) + '  ' + codeEditor.value.substring(end);
    codeEditor.selectionStart = codeEditor.selectionEnd = start + 2;
  }
});

// ── Boot ──

async function boot() {
  try {
    const useWorker = workerToggle.checked;
    const usePersist = persistToggle.checked;

    const kernel = new Kernel(undefined, { enableThreading: useWorker });
    await kernel.boot({ persist: usePersist });

    // Terminal UI
    const terminal = new Terminal(terminalContainer);

    // Command registry
    const registry = createDefaultRegistry();
    registry.register('node', createNodeCommand(kernel));
    registry.register('npm', createNpmCommand(kernel, registry));
    registry.register('npx', createNpxCommand(kernel, registry));
    registry.register('ps', createPsCommand(kernel));
    registry.register('top', createTopCommand(kernel));
    registry.register('kill', createKillCommand(kernel));
    registry.register('curl', createCurlCommand(kernel));
    bootLifoPackages(kernel.vfs, registry);

    // Initialize process executor
    const shellExecuteFn = kernel.createShellExecuteFn();
    const vfsReloadFn = async () => {
      const saved = await kernel.persistence.load();
      if (saved) {
        kernel.vfs.loadFromSerialized(saved);
      }
    };
    const vfsSaveFn = async () => {
      await kernel.persistence.open();
      await kernel.persistence.save(kernel.vfs.getRoot());
    };
    kernel.setProcessExecutor(createProcessExecutor(
      kernel.vfsDbName,
      registry,
      kernel.enableThreading,
      shellExecuteFn,
      vfsReloadFn,
      kernel.portRegistry,
      vfsSaveFn,
    ));

    // Shell
    const env = kernel.getDefaultEnv();
    const shell = new Shell(
      terminal,
      kernel.vfs,
      registry,
      env,
      kernel.processRegistry,
      kernel.processExecutor,
    );

    // Wire shell execution to kernel for process API and worker threads
    kernel.setShellExecute(async (cmd: string, ctx: any) => {
      const result = await shell.execute(cmd, {
        cwd: ctx.cwd,
        env: ctx.env,
        onStdout: (data: string) => ctx.stdout?.write(data),
        onStderr: (data: string) => ctx.stderr?.write(data),
      });
      return result.exitCode;
    });

    // Initialize kernel process API (syscall layer for child_process)
    kernel.initProcessAPI({ env });

    // Source profile files
    await shell.sourceFile('/etc/profile');
    await shell.sourceFile(env.HOME + '/.bashrc');
    await kernel.bootServices();

    // Start
    shell.start();
    terminal.focus();

    setStatus('ready', useWorker ? 'worker' : 'main thread');

    // ── VFS Inspector ──

    initVfsInspector(kernel.vfs);
    setLoadFileCallback((filePath: string) => {
      try {
        const content = kernel.vfs.readFileString(filePath);
        codeEditor.value = content;
        filenameInput.value = filePath;
      } catch (e: any) {
        console.error('Failed to load file:', e.message);
      }
    });

    // ── Editor actions ──

    function saveFile() {
      const filename = filenameInput.value.trim();
      const code = codeEditor.value;
      if (!filename) return;

      // Ensure parent directory exists
      const dir = filename.replace(/\/[^/]+$/, '');
      if (dir && dir !== filename) {
        try {
          kernel.vfs.mkdir(dir, { recursive: true });
        } catch {
          // ignore if exists
        }
      }

      kernel.vfs.writeFile(filename, code);
      refreshVfs();
    }

    async function runFile() {
      saveFile();
      const filename = filenameInput.value.trim();
      if (!filename) return;

      // Focus terminal and execute
      terminal.focus();
      // Type the command into the shell
      const cmd = `node ${filename}`;
      // Use shell.execute programmatically - write to terminal
      terminal.write(`\r\n\x1b[90m$ ${cmd}\x1b[0m\r\n`);
      const result = await shell.execute(cmd);
      if (result.exitCode !== 0) {
        terminal.write(`\x1b[31mExit code: ${result.exitCode}\x1b[0m\r\n`);
      }
      // Re-print prompt
      terminal.write(`\r\n`);
      refreshVfs();
    }

    runBtn.addEventListener('click', runFile);
    saveBtn.addEventListener('click', saveFile);

    // Ctrl/Cmd+Enter to run
    codeEditor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        runFile();
      }
      // Ctrl/Cmd+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    });

    // ── Controls ──

    clearBtn.addEventListener('click', () => {
      terminal.clear();
    });

    workerToggle.addEventListener('change', () => {
      localStorage.setItem(WORKER_KEY, workerToggle.checked ? '1' : '0');
      location.reload();
    });

    persistToggle.addEventListener('change', () => {
      localStorage.setItem(PERSIST_KEY, persistToggle.checked ? '1' : '0');
      location.reload();
    });

    resetVfsBtn.addEventListener('click', async () => {
      if (!confirm('This will delete all VFS data and reload. Continue?')) return;
      // Clear IndexedDB
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.removeItem(PERSIST_KEY);
      location.reload();
    });

  } catch (err) {
    console.error('Boot failed:', err);
    setStatus('error', 'error');
  }
}

boot();
