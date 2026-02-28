import type { AppDefinition, AppContext, AppInstance, MenuCategory } from '../../types';

class TextEditInstance implements AppInstance {
  readonly appId = 'textedit';
  private textarea: HTMLTextAreaElement | null = null;
  private filePath: string | null = null;
  private dirty = false;

  constructor(private ctx: AppContext, filePath?: string) {
    this.filePath = filePath ?? null;
  }

  mount(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: 100%; height: 100%; display: flex; flex-direction: column;
      background: #1e1f30;
    `;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.08);
      font-size: 12px; color: #a9b1d6;
    `;

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open...';
    openBtn.style.cssText = this.buttonStyle();
    openBtn.addEventListener('click', () => this.promptOpen());

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = this.buttonStyle();
    saveBtn.addEventListener('click', () => this.save());

    const pathLabel = document.createElement('span');
    pathLabel.style.cssText = 'flex:1; text-align:right; opacity:0.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    pathLabel.textContent = this.filePath ?? 'Untitled';

    toolbar.append(openBtn, saveBtn, pathLabel);

    // Editor
    this.textarea = document.createElement('textarea');
    this.textarea.style.cssText = `
      flex: 1; width: 100%; border: none; outline: none; resize: none;
      background: #1a1b26; color: #a9b1d6; padding: 12px; font-size: 14px;
      font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace;
      line-height: 1.6; tab-size: 4;
    `;
    this.textarea.spellcheck = false;

    this.textarea.addEventListener('input', () => {
      this.dirty = true;
    });

    // Cmd+S to save
    this.textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        this.save();
      }
    });

    wrapper.append(toolbar, this.textarea);
    container.appendChild(wrapper);

    // Load file if path provided
    if (this.filePath) {
      this.loadFile(this.filePath, pathLabel);
    }
  }

  unmount(): void {
    this.textarea = null;
  }

  focus(): void {
    this.textarea?.focus();
  }

  getTitle(): string {
    const name = this.filePath ? this.filePath.split('/').pop() : 'Untitled';
    return `${this.dirty ? '\u2022 ' : ''}${name} — TextEdit`;
  }

  getMenus(): MenuCategory[] {
    return [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: '\u2318N', action: () => {
            this.ctx.appRegistry.launch('textedit', this.ctx, this.ctx.windowManager);
          }},
          { label: 'Open...', shortcut: '\u2318O', action: () => this.promptOpen() },
          { label: 'Save', shortcut: '\u2318S', action: () => this.save() },
          { separator: true, label: '' },
          { label: 'Save As...', shortcut: '\u21E7\u2318S', action: () => this.promptSaveAs() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Select All', shortcut: '\u2318A', action: () => this.textarea?.select() },
        ],
      },
    ];
  }

  private async loadFile(path: string, pathLabel: HTMLElement): Promise<void> {
    try {
      const content = await this.ctx.kernel.vfs.readFile(path);
      if (this.textarea) {
        this.textarea.value = typeof content === 'string' ? content : new TextDecoder().decode(content);
      }
      this.filePath = path;
      this.dirty = false;
      pathLabel.textContent = path;
    } catch {
      if (this.textarea) this.textarea.value = '';
    }
  }

  private async save(): Promise<void> {
    if (!this.filePath || !this.textarea) {
      this.promptSaveAs();
      return;
    }
    try {
      await this.ctx.kernel.vfs.writeFile(this.filePath, this.textarea.value);
      this.dirty = false;
    } catch (e) {
      console.error('Save failed:', e);
    }
  }

  private promptOpen(): void {
    const path = prompt('Enter file path to open:', '/home/user/');
    if (path) {
      this.filePath = path;
      const pathLabel = this.textarea?.parentElement?.querySelector('span');
      if (pathLabel) this.loadFile(path, pathLabel as HTMLElement);
    }
  }

  private promptSaveAs(): void {
    const path = prompt('Save as:', this.filePath ?? '/home/user/untitled.txt');
    if (path) {
      this.filePath = path;
      this.save();
    }
  }

  private buttonStyle(): string {
    return `
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
      color: #a9b1d6; padding: 3px 10px; border-radius: 4px; cursor: pointer;
      font-size: 12px;
    `;
  }
}

export const textEditDefinition: AppDefinition = {
  id: 'textedit',
  name: 'TextEdit',
  icon: '\uD83D\uDCDD',
  extensions: ['.txt', '.md', '.json', '.js', '.ts', '.py', '.sh', '.css', '.html'],
  createInstance: (ctx, filePath) => new TextEditInstance(ctx, filePath),
};
