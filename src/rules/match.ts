import { addRoute, compareRoutes, createRouter, findAllRoutes } from "rou3";
import type { RouterContext } from "rou3";
import { parseRouteKey } from "./internal/key.ts";
import { mergeMatchedRouteRules } from "./merge.ts";
import type { RouteOverridePredicate, RouteRuleEntry, RouteRuleLayer } from "./merge.ts";
import { preMergeRuleLayers } from "./internal/premerge.ts";
import type { PreMergedRouteRules } from "./internal/premerge.ts";
import { ruleHandlers } from "./handlers/index.ts";
import { canonicalPath, mergedCanonicalPath, needsCanonicalPasses } from "./internal/scope.ts";
import type {
  MatchResult,
  MatchedRouteRule,
  RouteRules,
  RuleHandler,
  RuleHandlers,
} from "./types.ts";

export interface RouteRulesMatcherOptions {
  /**
   * Base URL prefix for all rule patterns (trailing slash trimmed).
   */
  baseURL?: string;
  /**
   * Add or override rule handler constructors by name.
   * Registry defaults are `headers`, `redirect`, `basicAuth`, `cors`; `cache` and
   * `proxy` are opt-in (register them from `h3/rules/cache` / `h3/rules/proxy`).
   * Setting a name to `undefined` makes that rule data-only.
   */
  handlers?: RuleHandlers;
  /**
   * Pre-merge each pattern's subsumption chain at startup so per-request
   * resolution takes only the most specific matched layer instead of merging
   * all layers. Exact — but requires a **chain-clean** rule set: throws at
   * startup if two patterns partially overlap (e.g. `/a/*​/c` vs `/a/b/*`) or
   * use patterns that cannot be analyzed (regex params).
   * Composes with {@link memoizeRouteRulesMatcher}.
   */
  preMerge?: boolean;
}

export interface MatcherMemoizeOptions {
  /**
   * Maximum number of memoized `method + pathname` entries. On overflow the
   * oldest entry is evicted (FIFO). `0` (or negative) disables memoization.
   * @default 1024
   */
  max?: number;
}

export type RouteRulesMatcher = (method: string, pathname: string) => MatchResult;

/** A `findAllRoutes`-compatible lookup, as produced by `rou3/compiler` codegen. */
export type FindRouteRules = (method: string, pathname: string) => RouteRuleLayer[];

/**
 * Explode a normalized rule set into per-rule entries and register them on a
 * rou3 router (method `""` = all methods).
 *
 * rou3 resolves `methods[method] || methods[""]` per node, which would let a
 * method-scoped registration shadow a method-agnostic rule on the same pattern —
 * so agnostic entries are prepended to each method-scoped registration to merge
 * (override), not shadow.
 */
export function createRulesRouter(
  rules: Record<string, RouteRules>,
  handlers: RuleHandlers,
  baseURL?: string,
  preMerge?: boolean,
): RouterContext<RouteRuleEntry[] | PreMergedRouteRules> {
  let base = baseURL || "";
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  const byPath = new Map<string, Map<string, RouteRuleEntry[]>>();
  for (const [key, rule] of Object.entries(rules)) {
    const { method, path } = parseRouteKey(key);
    const entries: RouteRuleEntry[] = [];
    for (const [name, options] of Object.entries(rule)) {
      if (options === undefined) {
        continue;
      }
      entries.push({
        name,
        route: path,
        options: base ? withScopeBase(name, options, base) : options,
        // A rule named `__proto__`/`constructor` would otherwise read a truthy
        // inherited `Object.prototype` member as its handler — gate on own membership.
        handler: (Object.hasOwn(handlers, name)
          ? handlers[name]
          : undefined) as MatchedRouteRule["handler"],
      });
    }
    let methods = byPath.get(path);
    if (!methods) {
      byPath.set(path, (methods = new Map()));
    }
    methods.set(method, [...(methods.get(method) || []), ...entries]);
  }
  const router = createRouter<RouteRuleEntry[] | PreMergedRouteRules>();
  if (preMerge) {
    for (const [path, methods] of preMergeRuleLayers(byPath)) {
      for (const [method, data] of methods) {
        addRoute(router, method, base + path, data);
      }
    }
    return router;
  }
  for (const [path, methods] of byPath) {
    const agnostic = methods.get("");
    for (const [method, entries] of methods) {
      const data = method && agnostic ? [...agnostic, ...entries] : entries;
      addRoute(router, method, base + path, data);
    }
  }
  return router;
}

/**
 * Create a route-rules matcher from a **normalized** rule set (see {@link normalizeRouteRules}).
 * Returns `(method, pathname) => { routeRules, routeRuleMiddleware }`.
 */
export function createRouteRulesMatcher(
  rules: Record<string, RouteRules>,
  opts?: RouteRulesMatcherOptions,
): RouteRulesMatcher {
  // `cache`/`proxy` have no default handler (opt-in subpaths so their deps stay
  // out of unrelated bundles) — fail loudly here rather than silently degrading
  // to a data-only rule; `handlers: { <name>: undefined }` opts into data-only.
  const handlers = {
    ...ruleHandlers,
    ...opts?.handlers,
  };
  requireOptInHandler(
    rules,
    handlers,
    "cache",
    "cache`/`swr",
    'Install `ocache` and pass `handlers: { cache }` from "h3/rules/cache", provide your own ' +
      "via `createCacheRuleHandler`, or pass `handlers: { cache: undefined }` to keep the rule data-only.",
  );
  requireOptInHandler(
    rules,
    handlers,
    "proxy",
    "proxy",
    'Pass `handlers: { proxy }` from "h3/rules/proxy", or `handlers: { proxy: undefined }` ' +
      "to keep the rule data-only.",
  );

  const router = createRulesRouter(rules, handlers, opts?.baseURL, opts?.preMerge);

  const findRouteRules: FindRouteRules = (method, pathname) =>
    findAllRoutes(router, method, pathname) as RouteRuleLayer[];

  // Memoization is opt-in (wrap with memoizeRouteRulesMatcher) so an un-memoized
  // bundle can tree-shake it away.
  // Inject the specificity guard here (not in createMatcherFromFind) so a
  // canonical reading can only override with an equal-or-more-specific pattern,
  // never downgrade — and so a compiled bundle that skips it tree-shakes rou3 out.
  return createMatcherFromFind(findRouteRules, canOverrideRoute);
}

// A later reading may override an already-resolved rule only when its matched
// pattern is equal to, or strictly more specific than, the current one (fail
// closed on subset/disjoint/partial — the served path's rule wins).
const canOverrideRoute: RouteOverridePredicate = (currentRoute, incomingRoute) => {
  if (currentRoute === incomingRoute) {
    return true;
  }
  const rel = compareRoutes(currentRoute, incomingRoute);
  return rel === "superset" || rel === "equal";
};

/**
 * Create a matcher from a `findAllRoutes`-compatible lookup — the integration
 * point for compiled matchers (`h3/rules/compiler`), sharing this exact code
 * path with the runtime matcher for identical results.
 *
 * Memoization is **not** wired in here — compose {@link memoizeRouteRulesMatcher}
 * explicitly so an un-memoized bundle can tree-shake it away.
 *
 * `canOverride` gates the dual-path union's override step (see
 * {@link mergeMatchedRouteRules}): omitted, a later reading overrides
 * unconditionally (historical behavior); `createRouteRulesMatcher` injects a
 * specificity guard so a broader canonical pattern can never downgrade a
 * narrower rule the served path resolved.
 */
export function createMatcherFromFind(
  findRouteRules: FindRouteRules,
  canOverride?: RouteOverridePredicate,
): RouteRulesMatcher {
  return (method, pathname) => {
    // h3 dispatches on event.url.pathname as-is (already once-decoded — only %2f
    // stays opaque); %2e/%5c handling below is defense-in-depth for non-h3 callers.
    const rawLayers = findRouteRules(method, pathname);

    // An encoded separator (`%2f`) must not dodge a rule the canonical path would
    // hit (e.g. admin%2fpanel vs admin/panel), and h3's canonical form keeps an
    // empty `//` segment that rou3 won't match against `/admin/**` — a
    // slash-merging downstream (nginx merge_slashes) could then reach a path whose
    // gate never ran. So also match the canonical and slash-merged readings
    // (the latter mirrors isPathInScope's second interpretation).
    //
    // Fast path: a pathname already canonical under the strictest reading is
    // canonical under both, so neither pass can differ from `rawLayers` — one
    // h3-owned scan (`isCanonicalPath`, never a local regex — see
    // `needsCanonicalPasses`) skips two resolves and two lookups
    // (~6% per un-memoized match).
    // A path that fails the guard pays both resolves; see `mergedCanonicalPath`
    // for why neither pass can be cheaply skipped without risking a bypass.
    let canonicalLayers: RouteRuleLayer[] | undefined;
    let mergedLayers: RouteRuleLayer[] | undefined;
    if (needsCanonicalPasses(pathname)) {
      const canonical = canonicalPath(pathname);
      canonicalLayers = canonical === pathname ? undefined : findRouteRules(method, canonical);
      // `undefined` when it agrees with `canonical` (and it can only equal
      // `pathname` when both readings do, which the guard above already excluded).
      const merged = mergedCanonicalPath(pathname, canonical);
      mergedLayers = merged === undefined ? undefined : findRouteRules(method, merged);
    }

    if (!rawLayers?.length && !canonicalLayers?.length && !mergedLayers?.length) {
      // Fresh objects: only memoized results are documented shared/read-only.
      return { routeRules: {}, routeRuleMiddleware: [] };
    }

    // Union raw/canonical/merged resolutions: each later pass may add or override
    // (never delete) a rule an earlier pass resolved, and override only when
    // `canOverride` allows it — a broader canonical pattern must never downgrade a
    // narrower rule the served path resolved (encoded-dot escalation). Proxy/redirect
    // still forward the raw `event.url.pathname`.
    const routeRules = mergeMatchedRouteRules(
      rawLayers,
      canonicalLayers,
      mergedLayers,
      canOverride,
    );

    // Handlers run sorted by `order` ascending (basicAuth -2, headers -1, so auth
    // gates before redirect/proxy and headers wrap the response). Skip sort for 0/1 rules.
    const routeRuleMiddleware: MatchResult["routeRuleMiddleware"] = [];
    const matchedRules = Object.values(routeRules) as MatchedRouteRule[];
    const orderedRules =
      matchedRules.length > 1 ? matchedRules.sort(compareRuleOrder) : matchedRules;
    for (const rule of orderedRules) {
      // merged rule sets never contain `false` options (types.ts: MatchedRouteRule)
      if (!rule.handler) {
        continue;
      }
      routeRuleMiddleware.push(rule.handler.handler(rule));
    }

    return { routeRules, routeRuleMiddleware };
  };
}

/**
 * Memoize a matcher per `method + pathname`. Exact — the merged result (params
 * included) is fully deterministic per path.
 *
 * Memoized results are **shared across requests**: treat the returned
 * `routeRules` map and middleware array as immutable. Entries are FIFO-capped
 * (default 1024) — an evicted path is simply re-resolved on its next hit.
 */
export function memoizeRouteRulesMatcher(
  matcher: RouteRulesMatcher,
  opts?: MatcherMemoizeOptions,
): RouteRulesMatcher {
  const max = opts?.max ?? 1024;
  if (max <= 0) {
    // A non-positive cap means no caching, not a cap of 1.
    return matcher;
  }
  const memo = new Map<string, MatchResult>();
  return (method, pathname) => {
    const key = method + " " + pathname;
    let result = memo.get(key);
    if (!result) {
      result = matcher(method, pathname);
      if (memo.size >= max) {
        memo.delete(memo.keys().next().value!);
      }
      memo.set(key, result);
    }
    return result;
  };
}

// ------------------------------------------------------------------------
// Internal
// ------------------------------------------------------------------------

// Fail loudly when an opt-in rule (`cache`/`proxy`) has no registered handler
// (otherwise it would silently degrade to data-only). A `false` reset is falsy,
// so reset-only rule sets don't throw; an own `<name>` key in `handlers` opts out.
function requireOptInHandler(
  rules: Record<string, RouteRules>,
  handlers: RuleHandlers,
  name: string,
  label: string,
  hint: string,
): void {
  if (name in handlers) {
    return;
  }
  for (const key in rules) {
    if (rules[key]![name]) {
      throw new Error(
        `[h3] rules: rules use \`${label}\` (\`${key}\`) but no \`${name}\` handler is registered. ${hint}`,
      );
    }
  }
}

// Sort by handler `order` ascending (default 0; built-ins occupy the negative
// band: cors -3, basicAuth -2, headers -1). Module-scope so it's not
// re-allocated per request.
const compareRuleOrder = (a: MatchedRouteRule, b: MatchedRouteRule): number =>
  orderWeight(a.handler) - orderWeight(b.handler);

function orderWeight(handler: RuleHandler | undefined): number {
  return handler?.order ?? 0;
}

// The redirect/proxy scope check runs against the full request path (including
// baseURL), so compose baseURL into `base` here (fresh object — never mutate
// the normalized rule set).
function withScopeBase(name: string, options: unknown, baseURL: string): unknown {
  if (
    (name === "redirect" || name === "proxy") &&
    options !== null &&
    typeof options === "object" &&
    typeof (options as { base?: unknown }).base === "string"
  ) {
    return { ...options, base: baseURL + (options as { base: string }).base };
  }
  return options;
}
