/**
 * Logger utility for worker thread logging
 * Works in both Node.js and browser environments
 */

// Detect environment
const isBrowser = typeof window !== 'undefined';

// Browser console styles
const styles = {
  workerPool: 'background: #7aa2f7; color: #1a1b26; padding: 2px 6px; border-radius: 3px; font-weight: bold',
  worker: 'background: #9ece6a; color: #1a1b26; padding: 2px 6px; border-radius: 3px; font-weight: bold',
  executor: 'background: #bb9af7; color: #1a1b26; padding: 2px 6px; border-radius: 3px; font-weight: bold',
  info: 'color: #7dcfff',
  success: 'color: #9ece6a',
  warning: 'color: #e0af68',
  error: 'color: #f7768e',
  reset: 'color: inherit',
};

interface LogOptions {
  emoji?: string;
  color?: keyof typeof styles;
}

class Logger {
  private prefix: string;
  private style: string;

  constructor(prefix: string, style: string) {
    this.prefix = prefix;
    this.style = style;
  }

  private formatMessage(emoji: string, message: string): [string, string[]] {
    if (isBrowser) {
      // Browser: Use console styles
      return [`%c[${this.prefix}]%c ${emoji} ${message}`, [this.style, 'color: inherit']];
    } else {
      // Node.js: Use simple text
      return [`[${this.prefix}] ${emoji} ${message}`, []];
    }
  }

  log(emoji: string, message: string, ...args: any[]): void {
    const [formatted, styleArgs] = this.formatMessage(emoji, message);
    console.log(formatted, ...styleArgs, ...args);
  }

  warn(emoji: string, message: string, ...args: any[]): void {
    const [formatted, styleArgs] = this.formatMessage(emoji, message);
    console.warn(formatted, ...styleArgs, ...args);
  }

  error(emoji: string, message: string, ...args: any[]): void {
    const [formatted, styleArgs] = this.formatMessage(emoji, message);
    console.error(formatted, ...styleArgs, ...args);
  }

  // Convenience methods
  info(message: string, ...args: any[]): void {
    this.log('ℹ️', message, ...args);
  }

  success(message: string, ...args: any[]): void {
    this.log('✅', message, ...args);
  }

  group(title: string): void {
    if (isBrowser && console.group) {
      const [formatted, styleArgs] = this.formatMessage('📂', title);
      console.group(formatted, ...styleArgs);
    } else {
      this.log('📂', title);
    }
  }

  groupEnd(): void {
    if (isBrowser && console.groupEnd) {
      console.groupEnd();
    }
  }
}

// Export logger instances
export const workerPoolLogger = new Logger('WorkerPool', styles.workerPool);
export const workerLogger = new Logger('Worker', styles.worker);
export const executorLogger = new Logger('ProcessExecutor', styles.executor);

// Export helper for creating custom loggers
export function createLogger(name: string, style: string): Logger {
  return new Logger(name, style);
}

// Export utility to check if running in browser
export const isRunningInBrowser = isBrowser;
