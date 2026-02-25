import type { AppDefinition, AppContext, AppInstance } from '../../types';

class AboutInstance implements AppInstance {
  readonly appId = 'about';

  constructor(private ctx: AppContext) {}

  mount(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: 100%; height: 100%; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      background: #1a1b26; color: #c0caf5; text-align: center; padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const logo = document.createElement('div');
    logo.style.cssText = 'font-size: 64px; margin-bottom: 8px;';
    logo.textContent = '\uD83D\uDDA5\uFE0F';

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 22px; font-weight: 700;';
    title.textContent = 'Lifo Desktop';

    const version = document.createElement('div');
    version.style.cssText = 'font-size: 13px; color: #565f89;';
    version.textContent = 'Version 1.0.0';

    const info = document.createElement('div');
    info.style.cssText = 'font-size: 12px; color: #565f89; line-height: 1.8;';

    // Gather system info
    const ua = navigator.userAgent;
    const mem = (navigator as unknown as Record<string, unknown>).deviceMemory ?? 'N/A';

    (async () => {
      let vfsInfo = '';
      try {
        const procVersion = await this.ctx.kernel.vfs.readFile('/proc/version');
        vfsInfo = typeof procVersion === 'string' ? procVersion : new TextDecoder().decode(procVersion);
      } catch {
        vfsInfo = 'Lifo Kernel';
      }

      info.innerHTML = [
        `Kernel: ${vfsInfo.trim()}`,
        `Browser: ${ua.split(') ').pop()?.split('/')[0] ?? ua}`,
        `Memory: ${mem} GB`,
        `Platform: ${navigator.platform}`,
      ].join('<br>');
    })();

    wrapper.append(logo, title, version, info);
    container.appendChild(wrapper);
  }

  unmount(): void {}

  getTitle(): string {
    return 'About This Mac';
  }
}

export const aboutDefinition: AppDefinition = {
  id: 'about',
  name: 'About This Mac',
  icon: '\u2139\uFE0F',
  createInstance: (ctx) => new AboutInstance(ctx),
};
