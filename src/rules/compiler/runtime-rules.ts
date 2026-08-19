/**
 * Default generated imports for built-in rules. Cache and proxy use opt-in
 * subpaths so their dependencies are included only when referenced.
 */
export const DEFAULT_RUNTIME_RULES: Readonly<Record<string, RuntimeRuleImport>> = Object.freeze({
  headers: "h3/rules",
  redirect: "h3/rules",
  proxy: "h3/rules/proxy",
  cache: "h3/rules/cache",
  cors: "h3/rules",
});

/** Module and optional named export for a generated rule-handler import. */
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

/** Merge custom runtime rule imports over {@link DEFAULT_RUNTIME_RULES}. */
export function resolveRuntimeRules(
  runtimeRules: Record<string, RuntimeRuleImport> | undefined,
): Readonly<Record<string, RuntimeRuleImport>> {
  return runtimeRules ? { ...DEFAULT_RUNTIME_RULES, ...runtimeRules } : DEFAULT_RUNTIME_RULES;
}

/** Check whether a runtime rule import is registered. */
export function isRuntimeRule(
  name: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): boolean {
  return Object.hasOwn(runtimeRules, name);
}

/** Resolve a registered runtime rule to its module and export name. */
export function resolveRuntimeRule(
  name: string,
  runtimeRules: Record<string, RuntimeRuleImport>,
): { source: string; export: string } {
  const entry = runtimeRules[name]!;
  return typeof entry === "string"
    ? { source: entry, export: name }
    : { source: entry.source, export: entry.export ?? name };
}
