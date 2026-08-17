/**
 * Default `runtimeRules` preset. `cache`/`proxy` point at their subpath so
 * those deps only enter a bundle when used; caller's `runtimeRules` merges
 * over this (see {@link resolveRuntimeRules}). Keep in sync with
 * `ruleHandlers` (src/rules/handlers/index.ts).
 */
export const DEFAULT_RUNTIME_RULES: Readonly<Record<string, RuntimeRuleImport>> = Object.freeze({
  headers: "h3/rules",
  redirect: "h3/rules",
  proxy: "h3/rules/proxy",
  cache: "h3/rules/cache",
  cors: "h3/rules",
});

/**
 * Where a runtime rule's handler is imported from: a bare module id (`source`
 * **must** have a named export whose identifier equals the rule key) or
 * `{ source, export }` when the export is named differently.
 */
export type RuntimeRuleImport = string | RuntimeRuleImportSpec;

export interface RuntimeRuleImportSpec {
  source: string;
  /**
   * Named export within `source`; must be a valid JS identifier (becomes an
   * import binding in generated code).
   * @default the rule key
   */
  export?: string;
}

/**
 * Caller's `runtimeRules` merged over {@link DEFAULT_RUNTIME_RULES}. Returns
 * the frozen preset directly when nothing is passed (no per-call allocation).
 */
export function resolveRuntimeRules(
  runtimeRules: Record<string, RuntimeRuleImport> | undefined,
): Readonly<Record<string, RuntimeRuleImport>> {
  return runtimeRules ? { ...DEFAULT_RUNTIME_RULES, ...runtimeRules } : DEFAULT_RUNTIME_RULES;
}

/** Whether `name` is registered as a runtime rule (own key of the `runtimeRules` record). */
export function isRuntimeRule(
  name: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): boolean {
  return Object.hasOwn(runtimeRules, name);
}

/**
 * Resolve a runtime rule's `{ source, export }`. Caller must have checked
 * {@link isRuntimeRule} first (entry is asserted non-null).
 */
export function resolveRuntimeRule(
  name: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): { source: string; export: string } {
  const entry = runtimeRules[name]!;
  return typeof entry === "string"
    ? { source: entry, export: name }
    : { source: entry.source, export: entry.export ?? name };
}
