import { createConditionResolver } from "../conditions.ts";
import { parseRouteKey, routeKeyMethod } from "../internal/key.ts";
import type { NormalizedRouteRules, RouteRuleCondition } from "../types.ts";

/** Name of the generated condition resolver export. */
export const CONDITION_RESOLVER_EXPORT_NAME = "resolveRouteRulesMethod";

/**
 * Generate the condition resolver import and export source, or `null` when
 * neither the rules nor the options involve conditions (output stays
 * byte-identical for rule sets without them).
 *
 * The export is `createConditionResolver(keys, conditions)` over one rule key
 * per `METHOD:NAME` pair and the conditions those keys use — the runtime
 * resolver itself, so compiled and runtime resolution cannot drift apart. It
 * is `undefined` when `conditions` is passed but no rule uses one, so callers
 * can import it unconditionally.
 *
 * Throws at compile time for what the runtime resolver rejects at startup (an
 * undefined or malformed condition), and when rules use conditions but none
 * are passed — the compiled module would otherwise never apply those rules.
 */
export function compileConditionResolverExport(
  rules: Record<string, NormalizedRouteRules>,
  conditions: Record<string, RouteRuleCondition> | undefined,
): { imports: string; body: string } | null {
  const keys = new Map<string, string>();
  for (const key in rules) {
    const { method, condition } = parseRouteKey(key);
    const scoped = routeKeyMethod(method, condition);
    if (condition && !keys.has(scoped)) {
      keys.set(scoped, key);
    }
  }
  if (keys.size === 0 && !conditions) {
    return null;
  }
  if (keys.size > 0 && !conditions) {
    const [key] = keys.values();
    throw new Error(
      `[h3] rules: compiler: rules use conditions (\`${key}\`) but no \`conditions\` option was passed — the compiled module could never apply them`,
    );
  }
  // Validates names, header names, and values exactly as the runtime does.
  createConditionResolver([...keys.values()], conditions);
  if (keys.size === 0) {
    return { imports: "", body: `export const ${CONDITION_RESOLVER_EXPORT_NAME} = undefined;\n` };
  }
  const used = [...new Set([...keys.values()].map((key) => parseRouteKey(key).condition!))].sort();
  const literal = `{${used
    .map((name) => `[${JSON.stringify(name)}]:${serializeCondition(conditions![name]!)}`)
    .join(",")}}`;
  return {
    imports: `import { createConditionResolver } from "h3/rules";`,
    body: `export const ${CONDITION_RESOLVER_EXPORT_NAME} = /* @__PURE__ */ createConditionResolver(${JSON.stringify(
      [...keys.values()],
    )}, ${literal});\n`,
  };
}

// Computed keys, so a `__proto__` name stays an own property instead of
// retargeting the literal's prototype.
function serializeCondition(condition: RouteRuleCondition): string {
  const headers = Object.entries(condition.headers)
    .map(
      ([header, expected]) =>
        `[${JSON.stringify(header)}]:${
          // `RegExp#toString` is a literal of the same pattern and flags (ECMA-262
          // EscapeRegExpPattern).
          expected instanceof RegExp ? String(expected) : JSON.stringify(expected)
        }`,
    )
    .join(",");
  return `{headers:{${headers}}}`;
}
