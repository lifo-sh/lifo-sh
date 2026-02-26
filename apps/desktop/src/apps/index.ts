import type { AppRegistry } from '../core/AppRegistry';
import { terminalDefinition } from './terminal/TerminalApp';
import { finderDefinition } from './finder/FinderApp';
import { textEditDefinition } from './textedit/TextEditApp';
import { aboutDefinition } from './about/AboutApp';

export function registerBuiltinApps(registry: AppRegistry): void {
  registry.register(terminalDefinition);
  registry.register(finderDefinition);
  registry.register(textEditDefinition);
  registry.register(aboutDefinition);
}

export { terminalDefinition, finderDefinition, textEditDefinition, aboutDefinition };
