import type { RuleHandlers } from "../types.ts";
import { cors } from "./cors.ts";
import { headers } from "./headers.ts";
import { redirect } from "./redirect.ts";

// Keep DEFAULT_RUNTIME_RULES (src/rules/compiler/runtime-rules.ts) in sync when
// adding rules, and export the handler from src/rules/index.ts.

/**
 * Default rule handler registry (base for runtime matchers). `cache` and
 * `proxy` are deliberately absent — opt-in subpath exports (`h3/rules/cache`,
 * `h3/rules/proxy`) so their deps stay out of bundles that don't use them.
 * `createRouteRulesMatcher` throws if a rule set uses either without a
 * registered handler (pass `handlers: { cache: undefined }` / `{ proxy: undefined }`
 * to opt into data-only).
 */
export const ruleHandlers: RuleHandlers = {
  headers,
  redirect,
  cors,
};
