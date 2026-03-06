/**
 * ES module → CommonJS syntax transformer.
 *
 * Rewrites import/export statements to require() / module.exports without
 * resolving or inlining any dependencies. All resolution happens at runtime
 * inside the worker via the require() runtime.
 *
 * Supported (single-line statements):
 *   import defaultExport from "mod"
 *   import * as ns from "mod"
 *   import { x, y as z } from "mod"
 *   import defaultExport, { x } from "mod"
 *   import "mod"                         (side-effect)
 *   import type { … } from "mod"         (stripped — TypeScript)
 *   export default <expr | function | class>
 *   export function / class / const / let / var NAME
 *   export { x, y as z }
 *   export { x } from "mod"
 *   export * from "mod"
 *   export type { … }                    (stripped — TypeScript)
 *   import("mod")  →  Promise.resolve(require("mod"))
 *   import(expr)   →  Promise.resolve(require(expr))
 */

function parseNames(s: string): Array<[orig: string, alias: string]> {
  return s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => {
      const i = x.search(/\s+as\s+/);
      if (i >= 0)
        return [x.slice(0, i).trim(), x.slice(i).replace(/^\s+as\s+/, '').trim()] as [string, string];
      return [x.trim(), x.trim()] as [string, string];
    });
}

export function transform(code: string): string {
  let out = code;
  const deferred: string[] = []; // exports appended at end (for function/class declarations)
  let counter = 0;
  const tmp = (): string => `__t${counter++}__`;

  // ── strip type-only imports/exports (TypeScript) ────────────────────────
  out = out.replace(/^[ \t]*import\s+type\s+.*?from\s+(['"`]).*?\1[ \t]*;?$/gm, '');
  out = out.replace(/^[ \t]*export\s+type\s+\{[^}]*\}(?:\s+from\s+(['"`]).*?\1)?[ \t]*;?$/gm, '');
  out = out.replace(/^[ \t]*export\s+type\s+\*\s+from\s+(['"`]).*?\1[ \t]*;?$/gm, '');

  // ── EXPORTS ─────────────────────────────────────────────────────────────

  // export * from "mod"
  out = out.replace(
    /^([ \t]*)export\s+\*\s+from\s+(['"`])(.*?)\2[ \t]*;?$/gm,
    (_, ind, _q, spec) =>
      `${ind}Object.assign(module.exports, require(${JSON.stringify(spec)}));`,
  );

  // export { ... } from "mod"
  out = out.replace(
    /^([ \t]*)export\s+\{([^}]*)\}\s+from\s+(['"`])(.*?)\3[ \t]*;?$/gm,
    (_, ind, names, _q, spec) => {
      const t = tmp();
      const stmts = parseNames(names)
        .map(([o, a]) => `module.exports.${a} = ${t}.${o};`)
        .join(' ');
      return `${ind}var ${t} = require(${JSON.stringify(spec)}); ${stmts}`;
    },
  );

  // export default async function/function/class NAME  (named — defer export assignment)
  out = out.replace(
    /^([ \t]*)export\s+default\s+(async\s+function\s*\*?|function\s*\*?|class)\s+(\w+)/gm,
    (_, ind, kw, name) => {
      deferred.push(`module.exports.default = ${name};`);
      return `${ind}${kw} ${name}`;
    },
  );

  // export default <expr>  (must come after named function/class rule above)
  out = out.replace(
    /^([ \t]*)export\s+default\s+/gm,
    (_, ind) => `${ind}module.exports.default = `,
  );

  // export async function / function / class NAME
  out = out.replace(
    /^([ \t]*)export\s+(async\s+function\s*\*?|function\s*\*?|class)\s+(\w+)/gm,
    (_, ind, kw, name) => {
      deferred.push(`module.exports.${name} = ${name};`);
      return `${ind}${kw} ${name}`;
    },
  );

  // export const / let / var NAME = ...  (single binding only)
  out = out.replace(
    /^([ \t]*)export\s+(const|let|var)\s+(\w+)\s*=/gm,
    (_, ind, kw, name) => `${ind}${kw} ${name} = module.exports.${name} =`,
  );

  // export { x, y as z }
  out = out.replace(
    /^([ \t]*)export\s+\{([^}]*)\}[ \t]*;?$/gm,
    (_, ind, names) =>
      `${ind}${parseNames(names)
        .map(([o, a]) => `module.exports.${a} = ${o};`)
        .join(' ')}`,
  );

  // ── IMPORTS ─────────────────────────────────────────────────────────────

  // import defaultExport, { ... } from "mod"
  out = out.replace(
    /^([ \t]*)import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+(['"`])(.*?)\4[ \t]*;?$/gm,
    (_, ind, def, named, _q, spec) => {
      const t = tmp();
      const parts = parseNames(named).map(([o, l]) => (o === l ? o : `${o}: ${l}`));
      return (
        `${ind}var ${t} = require(${JSON.stringify(spec)}); ` +
        `var ${def} = ${t}.default !== undefined ? ${t}.default : ${t}; ` +
        `var { ${parts.join(', ')} } = ${t};`
      );
    },
  );

  // import * as ns from "mod"
  out = out.replace(
    /^([ \t]*)import\s+\*\s+as\s+(\w+)\s+from\s+(['"`])(.*?)\3[ \t]*;?$/gm,
    (_, ind, ns, _q, spec) => `${ind}var ${ns} = require(${JSON.stringify(spec)});`,
  );

  // import defaultExport from "mod"
  out = out.replace(
    /^([ \t]*)import\s+(\w+)\s+from\s+(['"`])(.*?)\3[ \t]*;?$/gm,
    (_, ind, name, _q, spec) => {
      const t = tmp();
      return (
        `${ind}var ${t} = require(${JSON.stringify(spec)}); ` +
        `var ${name} = ${t}.default !== undefined ? ${t}.default : ${t};`
      );
    },
  );

  // import { ... } from "mod"
  out = out.replace(
    /^([ \t]*)import\s+\{([^}]*)\}\s+from\s+(['"`])(.*?)\3[ \t]*;?$/gm,
    (_, ind, names, _q, spec) => {
      const parts = parseNames(names).map(([o, l]) => (o === l ? o : `${o}: ${l}`));
      return `${ind}var { ${parts.join(', ')} } = require(${JSON.stringify(spec)});`;
    },
  );

  // import "mod"  (side-effect)
  out = out.replace(
    /^([ \t]*)import\s+(['"`])(.*?)\2[ \t]*;?$/gm,
    (_, ind, _q, spec) => `${ind}require(${JSON.stringify(spec)});`,
  );

  // ── DYNAMIC IMPORT ───────────────────────────────────────────────────────
  // import(expr)  →  __dynamicImport__(expr)
  // __dynamicImport__ is injected per-module so relative paths resolve
  // correctly from the calling module, not always from the entry point.
  out = out.replace(/\bimport\s*\(([^)]*)\)/g, (_, expr) =>
    `__dynamicImport__(${expr.trim()})`,
  );

  // ── deferred exports (function / class declarations) ─────────────────────
  if (deferred.length > 0) out += '\n' + deferred.join('\n');

  return out;
}
