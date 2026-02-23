export interface ArgSpec {
  [key: string]: {
    type: 'boolean' | 'string';
    short?: string;
  };
}

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positional: string[];
}

export function parseArgs(args: string[], spec: ArgSpec): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  // Build short -> long map
  const shortMap: Record<string, string> = {};
  for (const [long, def] of Object.entries(spec)) {
    if (def.short) shortMap[def.short] = long;
    flags[long] = def.type === 'boolean' ? false : '';
  }

  let stopFlags = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (stopFlags || !arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }

    if (arg === '--') {
      stopFlags = true;
      continue;
    }

    // --long or --long=value
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const name = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (name in spec) {
          flags[name] = spec[name].type === 'boolean' ? true : value;
        }
      } else {
        const name = arg.slice(2);
        if (name in spec) {
          if (spec[name].type === 'string') {
            flags[name] = args[++i] ?? '';
          } else {
            flags[name] = true;
          }
        }
      }
      continue;
    }

    // Short flags: -abc combined
    const chars = arg.slice(1);
    for (let j = 0; j < chars.length; j++) {
      const ch = chars[j];
      const longName = shortMap[ch];
      if (!longName) continue;
      if (spec[longName].type === 'string') {
        // Rest of chars or next arg is value
        const rest = chars.slice(j + 1);
        flags[longName] = rest || (args[++i] ?? '');
        break;
      } else {
        flags[longName] = true;
      }
    }
  }

  return { flags, positional };
}
