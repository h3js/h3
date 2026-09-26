import type { H3Event } from "../event.ts";
import { parseRouteKey } from "./internal/key.ts";
import type { RouteRuleCondition } from "./types.ts";

/**
 * Resolve the method a request is matched under: its HTTP method, plus every
 * condition it satisfies, sorted by name (`"GET:ANON:MD"`).
 */
export type ConditionResolver = (event: H3Event, method: string) => string;

/**
 * Create the request → rule-method resolver for the conditions a rule set uses
 * (`"GET:MD /blog/**"`), or `undefined` when no rule key carries a condition —
 * so a rule set without conditions pays nothing per request. Only the rule
 * keys are read, so a list of keys works as well as the rule set itself.
 *
 * Only conditions some rule scopes to the request's method are evaluated, and
 * every satisfied one applies. The resolved method is what to pass to the
 * matcher: each combination carries every plain rule of its base method too
 * (see `materializeDerivedMethods`).
 *
 * Throws when a rule key names a condition `conditions` does not define, or a
 * condition is malformed.
 */
export function createConditionResolver(
  rules: Record<string, unknown> | readonly string[],
  conditions: Record<string, RouteRuleCondition> | undefined,
): ConditionResolver | undefined {
  const used = new Map<string, Set<string>>();
  for (const key of Array.isArray(rules) ? rules : Object.keys(rules)) {
    const { method, condition } = parseRouteKey(key);
    if (!condition) {
      continue;
    }
    if (!conditions || !Object.hasOwn(conditions, condition)) {
      throw new Error(
        `[h3] rules: \`${key}\` uses the \`${condition}\` condition, which is not defined — pass it as \`conditions: { ${condition}: { headers: { ... } } }\``,
      );
    }
    // HEAD inherits GET rules, conditions included.
    for (const scoped of method === "GET" ? ["GET", "HEAD"] : [method]) {
      let names = used.get(scoped);
      if (!names) {
        used.set(scoped, (names = new Set()));
      }
      names.add(condition);
    }
  }
  if (used.size === 0) {
    return;
  }
  const tests = new Map<string, (event: H3Event) => boolean>();
  const candidates = Object.create(null) as Record<
    string,
    [suffix: string, test: (event: H3Event) => boolean][]
  >;
  for (const [method, names] of used) {
    // Sorted like the registrations (`materializeDerivedMethods`).
    candidates[method] = [...names].sort().map((name) => {
      let test = tests.get(name);
      if (!test) {
        tests.set(name, (test = compileCondition(name, conditions![name]!)));
      }
      return [":" + name, test];
    });
  }
  return (event, method) => {
    const names = candidates[method];
    if (!names) {
      return method;
    }
    let resolved = method;
    for (const [suffix, test] of names) {
      if (test(event)) {
        resolved += suffix;
      }
    }
    return resolved;
  };
}

function compileCondition(
  name: string,
  condition: RouteRuleCondition,
): (event: H3Event) => boolean {
  const headers = condition?.headers;
  const checks = headers && typeof headers === "object" ? Object.entries(headers) : [];
  // An empty predicate would apply the condition to every request.
  if (checks.length === 0) {
    throw new Error(`[h3] rules: condition \`${name}\` has no header checks`);
  }
  // Validate at startup: a bad value would otherwise throw on every request.
  const probe = new Headers();
  for (const [header, expected] of checks) {
    try {
      probe.get(header);
    } catch {
      throw new Error(
        `[h3] rules: condition \`${name}\` checks an invalid header name \`${header}\``,
      );
    }
    if (
      typeof expected !== "boolean" &&
      typeof expected !== "string" &&
      !(expected instanceof RegExp)
    ) {
      throw new Error(
        `[h3] rules: condition \`${name}\` header \`${header}\` must be a string, RegExp, or boolean`,
      );
    }
  }
  const lowered = checks.map(([header, expected]) => [header.toLowerCase(), expected] as const);
  return (event) => {
    for (const [header, expected] of lowered) {
      const value = event.req.headers.get(header);
      if (typeof expected === "boolean") {
        if ((value !== null) !== expected) {
          return false;
        }
      } else if (value === null) {
        return false;
      } else if (typeof expected === "string") {
        if (value !== expected) {
          return false;
        }
      } else {
        // A global/sticky RegExp carries `lastIndex` state across calls.
        expected.lastIndex = 0;
        if (!expected.test(value)) {
          return false;
        }
      }
    }
    return true;
  };
}
