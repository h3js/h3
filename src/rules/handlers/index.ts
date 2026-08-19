import type { RuleHandlers } from "../types.ts";
import { cors } from "./cors.ts";
import { headers } from "./headers.ts";
import { redirect } from "./redirect.ts";

// Keep DEFAULT_RUNTIME_RULES (src/rules/compiler/runtime-rules.ts) in sync when
// adding rules, and export the handler from src/rules/index.ts.

/**
 * Default handler registry. Cache and proxy handlers are opt-in from their
 * subpath exports; set either to `undefined` explicitly for data-only rules.
 */
export const ruleHandlers: RuleHandlers = {
  headers,
  redirect,
  cors,
};
