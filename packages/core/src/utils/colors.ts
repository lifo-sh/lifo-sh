export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const ITALIC = '\x1b[3m';
export const UNDERLINE = '\x1b[4m';

export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34m';
export const MAGENTA = '\x1b[35m';
export const CYAN = '\x1b[36m';
export const WHITE = '\x1b[37m';

export const BRIGHT_RED = '\x1b[91m';
export const BRIGHT_GREEN = '\x1b[92m';
export const BRIGHT_YELLOW = '\x1b[93m';
export const BRIGHT_BLUE = '\x1b[94m';
export const BRIGHT_MAGENTA = '\x1b[95m';
export const BRIGHT_CYAN = '\x1b[96m';

export function red(s: string): string { return RED + s + RESET; }
export function green(s: string): string { return GREEN + s + RESET; }
export function yellow(s: string): string { return YELLOW + s + RESET; }
export function blue(s: string): string { return BLUE + s + RESET; }
export function magenta(s: string): string { return MAGENTA + s + RESET; }
export function cyan(s: string): string { return CYAN + s + RESET; }
export function bold(s: string): string { return BOLD + s + RESET; }
export function dim(s: string): string { return DIM + s + RESET; }
