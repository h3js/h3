import { compareRoutes } from "rou3";
import type { RouteRuleEntry } from "../merge.ts";
import type { PreMergedRouteRules } from "../internal/premerge.ts";
import type { MatcherExport } from "./options.ts";
import { isRuntimeRule, type RuntimeRuleImport } from "./runtime-rules.ts";

/** Serialize a pre-merged layer wrapper (preMerge mode). */
export function serializePreMergedRouteRules(
  data: PreMergedRouteRules,
  ns: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): string {
  // `rank` is load-bearing, not metadata: it is how the runtime picks the most
  // specific matched layer (see `PreMergedRouteRules.rank`) — dropping it here
  // would make compiled preMerge fall back to layer position and silently lose
  // rules whose pattern rou3 returns out of containment order.
  return `{route:${JSON.stringify(data.route)},rank:${data.rank},rules:${serializeRouteRuleEntries(
    data.rules,
    ns,
    runtimeRules,
  )}}`;
}

/**
 * Serialize the rule entries registered for one pattern (one rou3 layer's
 * `.data`). Options must be JSON-serializable; anything JSON cannot
 * round-trip throws (see `assertSerializableOptions`).
 */
export function serializeRouteRuleEntries(
  entries: (RouteRuleEntry & { paramRoutes?: string[] })[],
  ns: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): string {
  return `[${entries
    .map((entry) => {
      const runtime = isRuntimeRule(entry.name, runtimeRules);
      if (runtime) {
        assertHandlerBinding(entry.name, "runtime rule name");
      }
      assertSerializableOptions(entry.options, entry, "options");
      return [
        `name:${JSON.stringify(entry.name)}`,
        `route:${JSON.stringify(entry.route)}`,
        runtime && `handler:${ns}$${entry.name}`,
        `options:${JSON.stringify(entry.options)}`,
        // Rank orders matched layers at runtime (see `RouteRuleEntry.rank`), so
        // it has to survive compilation or the compiled matcher merges them in
        // `findAllRoutes` order and loses gates the runtime one keeps. `0` is the
        // default and stays implicit — plain rule sets emit nothing extra.
        entry.rank && `rank:${entry.rank}`,
        entry.paramRoutes && `paramRoutes:${JSON.stringify(entry.paramRoutes)}`,
      ]
        .filter(Boolean)
        .join(",");
    })
    .map((fields) => `{${fields}}`)
    .join(",")}]`;
}

/** Default export name for the optional matcher export (`matcher: true`). */
const DEFAULT_MATCHER_EXPORT_NAME = "matcher";

/**
 * Resolve `matcher` into the infra import + export-declaration source, or
 * `null` if none requested. Wraps the `findRouteRules` binding the module
 * declares.
 */
export function compileMatcherExport(
  matcher: MatcherExport | undefined,
  overridePredicate: string,
): { imports: string; body: string } | null {
  if (!matcher) {
    return null;
  }
  const spec = typeof matcher === "string" ? { name: matcher } : matcher === true ? {} : matcher;
  const name = spec.name || DEFAULT_MATCHER_EXPORT_NAME;
  // Reject a non-identifier here, not as a parse error in the consumer's module.
  assertHandlerBinding(name, "matcher export name");
  const { memoize } = spec;
  // Baked override predicate gives the compiled matcher the same specificity
  // guard as runtime `createRouteRulesMatcher` (see compileOverridePredicate).
  let expr = `createMatcherFromFind(findRouteRules, ${overridePredicate})`;
  if (memoize) {
    // `{ max }` serializes as a 2nd arg; bare true/{} omits it (matches
    // memoizeRouteRulesMatcher's default).
    const max = memoize === true ? undefined : memoize.max;
    expr =
      max === undefined
        ? `memoizeRouteRulesMatcher(${expr})`
        : `memoizeRouteRulesMatcher(${expr}, { max: ${JSON.stringify(max)} })`;
  }
  return {
    imports: `import { createMatcherFromFind${
      memoize ? ", memoizeRouteRulesMatcher" : ""
    } } from "h3/rules";`,
    body: `export const ${name} = ${expr};\n`,
  };
}

/**
 * Emit the dual-path override predicate passed to `createMatcherFromFind` —
 * the compiled counterpart of the runtime `canOverrideRoute` guard: incoming
 * may override an already-resolved rule of the same name only if its pattern
 * is equal to, or strictly more specific than, the current one.
 *
 * `compareRoutes` runs here at build time (never in the emitted output),
 * baking the containment relation into a static table so rou3 stays out of
 * the runtime bundle. `routes` are the registered pattern strings, sorted for
 * deterministic output.
 */
export function compileOverridePredicate(routes: string[]): string {
  // current → incoming allowed when compareRoutes is "superset" or "equal";
  // everything else is absent from the table, so the predicate fails closed.
  const sorted = [...routes].sort();
  const allowed = new Map<string, string[]>();
  for (const current of sorted) {
    for (const incoming of sorted) {
      if (current === incoming) {
        continue;
      }
      const rel = compareRoutes(current, incoming);
      if (rel === "superset" || rel === "equal") {
        let list = allowed.get(current);
        if (!list) {
          allowed.set(current, (list = []));
        }
        list.push(incoming);
      }
    }
  }
  // No overlaps: only identical routes may override, so identity check suffices.
  if (allowed.size === 0) {
    return "(a, b) => a === b";
  }
  const entries = [...allowed]
    .map(([current, list]) => `[${JSON.stringify(current)}, new Set(${JSON.stringify(list)})]`)
    .join(", ");
  return `/* @__PURE__ */ (() => { const t = new Map([${entries}]); return (a, b) => a === b || (t.get(a)?.has(b) ?? false); })()`;
}

/**
 * Validates every binding name the compiler emits — a non-identifier would
 * otherwise surface as a parse error in the consumer's generated module.
 */
export function assertHandlerBinding(name: string, what: string): void {
  if (!JS_IDENTIFIER_RE.test(name)) {
    throw new Error(
      `[h3] rules: compiler: ${what} \`${name}\` is not a valid JS identifier — it is used as a binding in generated code`,
    );
  }
}

// ---- Internal ----

const JS_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

// `JSON.stringify` silently drops functions/undefined and mangles class
// instances (Date→string, RegExp→{}) — diverging compiled from runtime matcher
// with no error. Reject anything JSON cannot round-trip instead.
function assertSerializableOptions(value: unknown, entry: RouteRuleEntry, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      assertSerializableOptions(item, entry, `${path}[${i}]`);
    }
    return;
  }
  const proto = typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    for (const [key, item] of Object.entries(value as object)) {
      // A `__proto__` key in a JS object literal is the prototype-setter
      // production (ECMA-262), not a data property — it would silently retarget
      // the object's prototype instead of round-tripping, diverging from the
      // runtime matcher (which carries it as data).
      if (key === "__proto__") {
        throw new Error(
          `[h3] rules: compiler: \`${entry.name}\` rule for \`${entry.route}\` has a \`__proto__\` key at \`${path}\` — it cannot be embedded as a JS object literal without changing the object's prototype (its JSON.stringify output would diverge from the runtime matcher); rename or remove it`,
        );
      }
      assertSerializableOptions(item, entry, `${path}.${key}`);
    }
    return;
  }
  const kind =
    typeof value === "object" ? (value as object).constructor?.name || "object" : typeof value;
  throw new Error(
    `[h3] rules: compiler: \`${entry.name}\` rule for \`${entry.route}\` has a non-JSON-serializable value at \`${path}\` (${kind}) — compiled rule options must survive a JSON round-trip`,
  );
}
