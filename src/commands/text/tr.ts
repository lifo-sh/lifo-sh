import type { Command } from '../types.js';

function expandRange(set: string): string {
  let result = '';
  let i = 0;
  while (i < set.length) {
    if (i + 2 < set.length && set[i + 1] === '-') {
      const start = set.charCodeAt(i);
      const end = set.charCodeAt(i + 2);
      for (let c = start; c <= end; c++) {
        result += String.fromCharCode(c);
      }
      i += 3;
    } else {
      result += set[i];
      i++;
    }
  }
  return result;
}

const command: Command = async (ctx) => {
  let deleteMode = false;
  let squeezeMode = false;
  const sets: string[] = [];

  for (const arg of ctx.args) {
    if (arg === '-d') {
      deleteMode = true;
    } else if (arg === '-s') {
      squeezeMode = true;
    } else {
      sets.push(arg);
    }
  }

  if (sets.length === 0) {
    ctx.stderr.write('tr: missing operand\n');
    return 1;
  }

  let text = '';
  if (ctx.stdin) {
    text = await ctx.stdin.readAll();
  } else {
    ctx.stderr.write('tr: missing input\n');
    return 1;
  }

  const set1 = expandRange(sets[0]);

  if (deleteMode) {
    // Delete characters in set1
    let result = '';
    for (const ch of text) {
      if (!set1.includes(ch)) result += ch;
    }
    ctx.stdout.write(result);
    return 0;
  }

  if (squeezeMode && sets.length === 1) {
    // Squeeze repeated characters in set1
    let result = '';
    let lastCh = '';
    for (const ch of text) {
      if (set1.includes(ch) && ch === lastCh) continue;
      result += ch;
      lastCh = ch;
    }
    ctx.stdout.write(result);
    return 0;
  }

  if (sets.length < 2) {
    ctx.stderr.write('tr: missing operand after set1\n');
    return 1;
  }

  const set2 = expandRange(sets[1]);

  // Build translation map
  const map = new Map<string, string>();
  for (let i = 0; i < set1.length; i++) {
    map.set(set1[i], set2[Math.min(i, set2.length - 1)]);
  }

  let result = '';
  for (const ch of text) {
    result += map.get(ch) ?? ch;
  }

  // If squeeze mode is also set, squeeze the translated chars
  if (squeezeMode) {
    const set2Chars = new Set(set2);
    let squeezed = '';
    let lastCh = '';
    for (const ch of result) {
      if (set2Chars.has(ch) && ch === lastCh) continue;
      squeezed += ch;
      lastCh = ch;
    }
    result = squeezed;
  }

  ctx.stdout.write(result);
  return 0;
};

export default command;
