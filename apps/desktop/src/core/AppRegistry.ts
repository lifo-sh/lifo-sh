import type { AppDefinition, AppContext, AppInstance } from '../types';
import type { WindowManager } from './WindowManager';

export class AppRegistry {
  private apps = new Map<string, AppDefinition>();
  private extensionMap = new Map<string, string>(); // ext -> appId

  register(definition: AppDefinition): void {
    this.apps.set(definition.id, definition);
    if (definition.extensions) {
      for (const ext of definition.extensions) {
        this.extensionMap.set(ext.toLowerCase(), definition.id);
      }
    }
  }

  get(appId: string): AppDefinition | undefined {
    return this.apps.get(appId);
  }

  getAll(): AppDefinition[] {
    return [...this.apps.values()];
  }

  getAppForExtension(ext: string): AppDefinition | undefined {
    const appId = this.extensionMap.get(ext.toLowerCase());
    return appId ? this.apps.get(appId) : undefined;
  }

  launch(appId: string, ctx: AppContext, windowManager: WindowManager): AppInstance | null {
    const def = this.apps.get(appId);
    if (!def) return null;

    const instance = def.createInstance(ctx);
    windowManager.createWindow(appId, instance);
    return instance;
  }

  openFile(path: string, ctx: AppContext, windowManager: WindowManager): AppInstance | null {
    const ext = '.' + (path.split('.').pop() ?? '');
    const def = this.getAppForExtension(ext);

    if (def) {
      const instance = def.createInstance(ctx);
      // If the app supports opening files, we pass it through mount context
      windowManager.createWindow(def.id, instance);
      return instance;
    }

    // Default to TextEdit for any text file
    const textEdit = this.apps.get('textedit');
    if (textEdit) {
      const instance = textEdit.createInstance(ctx);
      windowManager.createWindow('textedit', instance);
      return instance;
    }

    return null;
  }
}
