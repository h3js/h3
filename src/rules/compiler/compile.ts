import type { RouterContext } from "rou3";
import { compileRouterToString } from "rou3/compiler";
import { createRulesRouter } from "../match.ts";
import type { RouteRuleEntry } from "../merge.ts";
import { normalizeRouteRules } from "../normalize.ts";
import { parseRouteKey } from "../internal/key.ts";
import type { PreMergedRouteRules } from "../internal/premerge.ts";
import type { NormalizedRouteRules, RouteRuleConfig } from "../types.ts";
import {
  assertHandlerBinding,
  compileMatcherExport,
  compileOverridePredicate,
  serializePreMergedRouteRules,
  serializeRouteRuleEntries,
} from "./codegen.ts";
import {
  DEFAULT_HANDLERS_IMPORT_NAME,
  type CompileModuleOptions,
  type CompileRouteRulesOptions,
  type CompiledRouteRules,
} from "./options.ts";
import {
  isRuntimeRule,
  resolveRuntimeRule,
  resolveRuntimeRules,
  type RuntimeRuleImport,
} from "./runtime-rules.ts";

/**
 * Compile a rule set into a complete ESM module exporting `findRouteRules`
 * (and, with `matcher`, a ready-to-use matcher). Input is normalized
 * internally — pass authored config or already-normalized rules.
 */
export function compileRouteRules(
  config: Record<string, RouteRuleConfig>,
  opts: CompileModuleOptions = {},
): CompiledRouteRules {
  // Both emitters read the same ctx, so handler imports cannot desync from
  // the handler refs in findRouteRules; a preMerge fallback warns once per call.
  const ctx = resolveCompileCtx(config, opts);
  const handlerImports = emitHandlersImport(ctx);
  // Matcher declaration follows findRouteRules in body (references that local
  // binding). Predicate gives the compiled matcher the runtime's specificity guard.
  const matcherExport = opts.matcher
    ? compileMatcherExport(opts.matcher, compileOverridePredicate(collectRoutes(ctx)))
    : null;
  const imports = [handlerImports, matcherExport?.imports].filter(Boolean).join("\n");
  const find = `export const findRouteRules = ${emitFindRouteRules(ctx)};\n`;
  const body = matcherExport ? find + matcherExport.body : find;
  const code = `${imports ? imports + "\n" : ""}${body}`;
  return { imports, body, code, toString: () => code };
}

/**
 * Compile a rule set into the source of a `findRouteRules(method, pathname)`
 * function expression. Entries reference handler constructors as
 * `<handlersImportName>$<name>` bindings — pair with
 * {@link compileHandlersImport} (which imports exactly those names).
 */
export function compileFindRouteRules(
  config: Record<string, RouteRuleConfig>,
  opts: CompileRouteRulesOptions = {},
): string {
  return emitFindRouteRules(resolveCompileCtx(config, opts));
}

/**
 * Import statement for exactly the handlers the rule set references (empty
 * string if none), keeping unused handlers' deps (e.g. ocache) tree-shakeable.
 * Input is normalized internally, so e.g. an `swr` shortcut counts as `cache`.
 */
export function compileHandlersImport(
  config: Record<string, RouteRuleConfig>,
  opts: CompileRouteRulesOptions = {},
): string {
  return emitHandlersImport(resolveCompileCtx(config, opts));
}

/**
 * Everything the fragment emitters need, resolved once per entrypoint call.
 * Both emitters read the same context, so handler references and the
 * handlers import can never disagree.
 */
interface CompileCtx {
  /** Normalized rule set (see the normalization note in {@link resolveCompileCtx}). */
  rules: Record<string, NormalizedRouteRules>;
  /** Effective preMerge mode — `opts.preMerge` after the fail-safe fallback. */
  preMerge: boolean;
  /**
   * Pre-merged router from the preMerge probe, kept so
   * {@link emitFindRouteRules} doesn't redo the expensive analysis. Unset in
   * plain mode.
   */
  router?: RouterContext<RouteRuleEntry[] | PreMergedRouteRules>;
  /** Caller's `runtimeRules` merged over {@link DEFAULT_RUNTIME_RULES}. */
  runtimeRules: Readonly<Record<string, RuntimeRuleImport>>;
  /** Validated handler-binding namespace (`<ns>$<name>` bindings). */
  ns: string;
  baseURL?: string;
}

/**
 * Resolve the shared compile context for one public entrypoint call.
 *
 * Every entrypoint normalizes its own input (unlike the runtime matcher,
 * which takes pre-normalized rules) — raw config would otherwise silently
 * mis-compile (e.g. an unexpanded `swr` shortcut compiling as data-only).
 * Normalization is idempotent (pinned in test/rules/normalize.test.ts), so
 * pre-normalized input passes through unchanged.
 *
 * preMerge is fail-safe: a non-chain-clean rule set warns once and falls back
 * to plain compilation rather than failing the build. The probe *is* the
 * pre-merged router build, so a successful probe's router is kept on the
 * context.
 */
function resolveCompileCtx(
  config: Record<string, RouteRuleConfig>,
  opts: CompileRouteRulesOptions,
): CompileCtx {
  // Idempotent including key order (pinned — test/rules/normalize.test.ts,
  // test/rules/compiler.test.ts byte-equality), so authored/pre-normalized input
  // compile identically.
  const rules = normalizeRouteRules(config);
  const ns = opts.handlersImportName || DEFAULT_HANDLERS_IMPORT_NAME;
  assertHandlerBinding(ns, "handlersImportName");
  const ctx: CompileCtx = {
    rules,
    preMerge: false,
    runtimeRules: resolveRuntimeRules(opts.runtimeRules),
    ns,
    baseURL: opts.baseURL,
  };
  if (opts.preMerge) {
    try {
      // Runs the pre-merge analysis, which throws on a non-chain-clean rule set.
      ctx.router = createRulesRouter(rules, {}, opts.baseURL, true);
      ctx.preMerge = true;
    } catch (error) {
      console.warn(
        `[h3] rules: compiler: preMerge could not be applied — falling back to plain compilation.\n  ${(error as Error).message}`,
      );
    }
  }
  return ctx;
}

/**
 * Emit the `findRouteRules` function-expression source. Builds the same
 * router as the runtime matcher so both behave identically; reuses the
 * context's pre-merged router when the probe succeeded.
 */
function emitFindRouteRules(ctx: CompileCtx): string {
  const router = ctx.router ?? createRulesRouter(ctx.rules, {}, ctx.baseURL, ctx.preMerge);
  return compileRouterToString(router, undefined, {
    matchAll: true,
    serialize: (data) =>
      Array.isArray(data)
        ? serializeRouteRuleEntries(data as RouteRuleEntry[], ctx.ns, ctx.runtimeRules)
        : serializePreMergedRouteRules(data as PreMergedRouteRules, ctx.ns, ctx.runtimeRules),
  });
}

/**
 * Emit the handlers import statement(s) for a resolved context: exactly the
 * handlers {@link emitFindRouteRules} references for the same context (empty
 * string if none).
 */
function emitHandlersImport(ctx: CompileCtx): string {
  const names = usedRuleHandlerNames(ctx);
  if (names.length === 0) {
    return "";
  }
  // One import statement per distinct source (a rule can override where its
  // handler comes from); sorted for deterministic output.
  const bySource = new Map<string, string[]>();
  for (const name of names) {
    assertHandlerBinding(name, "runtime rule name");
    const { source, export: exportName } = resolveRuntimeRule(name, ctx.runtimeRules);
    assertHandlerBinding(exportName, "runtime rule export");
    let specs = bySource.get(source);
    if (!specs) {
      bySource.set(source, (specs = []));
    }
    specs.push(`${exportName} as ${ctx.ns}$${name}`);
  }
  return [...bySource.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([source, specs]) => `import { ${specs.join(", ")} } from ${JSON.stringify(source)};`)
    .join("\n");
}

/**
 * Distinct registered pattern strings — the only values that can reach the
 * override predicate as a matched entry's `route` (baseURL is a uniform
 * prefix, so containment is unaffected).
 */
function collectRoutes(ctx: CompileCtx): string[] {
  const routes = new Set<string>();
  for (const key in ctx.rules) {
    routes.add(parseRouteKey(key).path);
  }
  return [...routes];
}

/** Runtime rule names a context actually uses (sorted). */
function usedRuleHandlerNames(ctx: CompileCtx): string[] {
  const used = new Set<string>();
  for (const key in ctx.rules) {
    for (const [name, options] of Object.entries(ctx.rules[key]!)) {
      // preMerge resolves `false` resets at compile time (no handler ref);
      // plain mode still references them. ctx.preMerge is the effective
      // (post-fallback) mode.
      if (
        options !== undefined &&
        (options !== false || !ctx.preMerge) &&
        isRuntimeRule(name, ctx.runtimeRules)
      ) {
        used.add(name);
      }
    }
  }
  return [...used].sort();
}
