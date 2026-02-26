import type { EventBus } from './EventBus';
import type { WindowManager } from './WindowManager';
import type { MenuCategory, MenuItem } from '../types';

export class MenuBar {
  readonly el: HTMLElement;
  private menusContainer: HTMLElement;
  private clockEl: HTMLElement;
  private openDropdown: HTMLElement | null = null;
  private openMenuEl: HTMLElement | null = null;
  private clockInterval: ReturnType<typeof setInterval>;

  constructor(
    container: HTMLElement,
    private eventBus: EventBus,
    private windowManager: WindowManager,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'lf-menubar';

    // Logo
    const logo = document.createElement('div');
    logo.className = 'lf-menubar-logo';
    logo.textContent = '\uF8FF Lifo';

    // Menus
    this.menusContainer = document.createElement('div');
    this.menusContainer.className = 'lf-menubar-menus';

    // Right side
    const right = document.createElement('div');
    right.className = 'lf-menubar-right';

    this.clockEl = document.createElement('div');
    this.clockEl.className = 'lf-menubar-clock';
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 30_000);

    right.appendChild(this.clockEl);

    this.el.append(logo, this.menusContainer, right);
    container.appendChild(this.el);

    // Update menus when focus changes
    this.eventBus.on('window:focus', () => this.refreshMenus());
    this.eventBus.on('window:close', () => this.refreshMenus());
    this.eventBus.on('menu:update', () => this.refreshMenus());

    // Close dropdown on outside click
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.contains(e.target as Node)) {
        this.closeDropdown();
      }
    });

    // Build default menus
    this.refreshMenus();
  }

  private refreshMenus(): void {
    this.menusContainer.innerHTML = '';

    const focused = this.windowManager.getFocusedWindow();
    const appMenus = focused?.appInstance?.getMenus?.() ?? [];

    // Always show default menus
    const allMenus: MenuCategory[] = [
      ...appMenus,
      {
        label: 'Window',
        items: [
          { label: 'Minimize', shortcut: '\u2318M', action: () => this.minimizeFocused() },
          { label: 'Maximize', action: () => this.maximizeFocused() },
          { separator: true, label: '' },
          { label: 'Close', shortcut: '\u2318W', action: () => this.closeFocused() },
        ],
      },
    ];

    for (const category of allMenus) {
      const menuEl = document.createElement('div');
      menuEl.className = 'lf-menubar-menu';

      const label = document.createElement('span');
      label.className = 'lf-menubar-menu-label';
      label.textContent = category.label;
      menuEl.appendChild(label);

      menuEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.openMenuEl === menuEl) {
          this.closeDropdown();
        } else {
          this.showDropdown(menuEl, category.items);
        }
      });

      menuEl.addEventListener('mouseenter', () => {
        if (this.openDropdown && this.openMenuEl !== menuEl) {
          this.showDropdown(menuEl, category.items);
        }
      });

      this.menusContainer.appendChild(menuEl);
    }
  }

  private showDropdown(menuEl: HTMLElement, items: MenuItem[]): void {
    this.closeDropdown();

    this.openMenuEl = menuEl;
    menuEl.classList.add('open');

    const dropdown = document.createElement('div');
    dropdown.className = 'lf-menubar-dropdown';

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'lf-menubar-dropdown-separator';
        dropdown.appendChild(sep);
        continue;
      }

      const el = document.createElement('div');
      el.className = 'lf-menubar-dropdown-item';
      if (item.disabled) el.classList.add('disabled');

      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;
      el.appendChild(labelSpan);

      if (item.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'shortcut';
        shortcut.textContent = item.shortcut;
        el.appendChild(shortcut);
      }

      if (item.action && !item.disabled) {
        el.addEventListener('click', () => {
          item.action!();
          this.closeDropdown();
        });
      }

      dropdown.appendChild(el);
    }

    menuEl.appendChild(dropdown);
    this.openDropdown = dropdown;
  }

  private closeDropdown(): void {
    if (this.openDropdown) {
      this.openDropdown.remove();
      this.openDropdown = null;
    }
    if (this.openMenuEl) {
      this.openMenuEl.classList.remove('open');
      this.openMenuEl = null;
    }
  }

  private minimizeFocused(): void {
    const win = this.windowManager.getFocusedWindow();
    if (win) this.windowManager.minimizeWindow(win.state.id);
  }

  private maximizeFocused(): void {
    const win = this.windowManager.getFocusedWindow();
    if (win) this.windowManager.maximizeWindow(win.state.id);
  }

  private closeFocused(): void {
    const win = this.windowManager.getFocusedWindow();
    if (win) this.windowManager.closeWindow(win.state.id);
  }

  private updateClock(): void {
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = dayNames[now.getDay()];
    const month = monthNames[now.getMonth()];
    const date = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    this.clockEl.textContent = `${day} ${month} ${date}  ${h12}:${minutes} ${ampm}`;
  }

  destroy(): void {
    clearInterval(this.clockInterval);
    this.el.remove();
  }
}
