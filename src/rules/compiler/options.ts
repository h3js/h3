import type { MatcherMemoizeOptions } from "../match.ts";
import type { RuntimeRuleImport } from "./runtime-rules.ts";

/** Default identifier prefix for imported handlers (`<prefix>$<name>` bindings). */
export const DEFAULT_HANDLERS_IMPORT_NAME = "__ruleHandlers__";

export interface CompileRouteRulesOptions {
  /** Base URL prefix for all rule patterns (trailing slash trimmed). */
  baseURL?: string;
  /**
   * Identifier prefix for imported handlers in generated code (handler `name`
   * binds as `<prefix>$<name>`).
   * @default "__ruleHandlers__"
   */
  handlersImportName?: string;
  /**
   * Runtime rules keyed by rule name, merged **over** `DEFAULT_RUNTIME_RULES`
   * (list only additions/overrides). Keys bind as JS identifiers in generated
   * code.
   * @default DEFAULT_RUNTIME_RULES
   */
  runtimeRules?: Record<string, RuntimeRuleImport>;
  /**
   * Pre-merge each pattern's subsumption chain at compile time (exact, but
   * requires a **chain-clean** rule set). Unlike the runtime matcher, the
   * compiler is fail-safe: a non-chain-clean set emits a `console.warn` and
   * falls back to plain compilation instead of throwing.
   */
  preMerge?: boolean;
}

/**
 * Optional matcher export appended alongside `findRouteRules`; `true`/string
 * wraps it in `createMatcherFromFind` (optionally renamed). `memoize` bakes in
 * `memoizeRouteRulesMatcher`, imported only when set — an un-memoized export
 * still tree-shakes it away.
 */
export type MatcherExport =
  | boolean
  | string
  | { name?: string; memoize?: boolean | MatcherMemoizeOptions };

/**
 * {@link compileRouteRules} options — base options plus the whole-module-only
 * `matcher` knob (meaningless for the single-fragment entrypoints).
 */
export interface CompileModuleOptions extends CompileRouteRulesOptions {
  /**
   * Also emit a ready-to-use matcher export. See {@link MatcherExport}.
   * @default false
   */
  matcher?: MatcherExport;
}

/**
 * Compiled `findRouteRules` module split into composable parts: take the
 * whole module ({@link code}) or weave {@link imports}/{@link body} into a
 * larger one without re-parsing.
 */
export interface CompiledRouteRules {
  /**
   * Handler import statements ({@link compileHandlersImport} output); empty
   * for a data-only rule set. Includes the matcher infra import when one is
   * requested.
   */
  imports: string;
  /**
   * `findRouteRules` export declaration (no imports), plus the matcher
   * declaration when requested. References bindings {@link imports} brings
   * into scope.
   */
  body: string;
  /** The complete module source — {@link imports} then {@link body}. Same as `toString()`. */
  code: string;
  /** The complete module source ({@link code}), so the result interpolates as a string. */
  toString(): string;
}
