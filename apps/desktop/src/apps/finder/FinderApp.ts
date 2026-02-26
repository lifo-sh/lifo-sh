import { FileExplorer } from '@lifo-sh/ui';
import type { AppDefinition, AppContext, AppInstance, MenuCategory } from '../../types';

class FinderInstance implements AppInstance {
  readonly appId = 'finder';
  private explorer: FileExplorer | null = null;

  constructor(private ctx: AppContext, private initialPath: string = '/home/user') {}

  mount(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    container.appendChild(wrapper);

    this.explorer = new FileExplorer(wrapper, this.ctx.kernel.vfs, {
      cwd: this.initialPath,
    });
  }

  unmount(): void {
    this.explorer?.destroy();
    this.explorer = null;
  }

  focus(): void {}

  getTitle(): string {
    return 'Finder';
  }

  getMenus(): MenuCategory[] {
    return [
      {
        label: 'File',
        items: [
          { label: 'New Finder Window', shortcut: '\u2318N', action: () => {
            this.ctx.appRegistry.launch('finder', this.ctx, this.ctx.windowManager);
          }},
          { separator: true, label: '' },
          { label: 'New Folder', shortcut: '\u21E7\u2318N', action: () => {} },
        ],
      },
      {
        label: 'Go',
        items: [
          { label: 'Home', shortcut: '\u21E7\u2318H', action: () => this.explorer?.navigateTo('/home/user') },
          { label: 'Desktop', shortcut: '\u2318D', action: () => this.explorer?.navigateTo('/home/user/Desktop') },
          { label: 'Root', action: () => this.explorer?.navigateTo('/') },
        ],
      },
    ];
  }
}

export const finderDefinition: AppDefinition = {
  id: 'finder',
  name: 'Finder',
  icon: '\uD83D\uDCC1',
  createInstance: (ctx) => new FinderInstance(ctx),
};
