import { addRoute, compareRoutes, createRouter, findAllRoutes } from "rou3";
import type { RouterContext } from "rou3";
import { parseRouteKey } from "./internal/key.ts";
import { mergeMatchedRouteRules } from "./merge.ts";
import type { RouteOverridePredicate, RouteRuleEntry, RouteRuleLayer } from "./merge.ts";
import { preMergeRuleLayers } from "./internal/premerge.ts";
import type { PreMergedRouteRules } from "./internal/premerge.ts";
import { ruleHandlers } from "./handlers/index.ts";
import {
  canonicalPath,
  decodedPath,
  mergedCanonicalPath,
  needsCanonicalPasses,
} from "./internal/scope.ts";
import type {
  MatchResult,
  MatchedRouteRule,
  MatchedRouteRules,
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
  // HEAD is served by the GET handler (RFC 9110) — h3 falls back to the GET
  // route in `~findRoute` and its middleware matcher treats GET-scoped as
  // HEAD-matching — so GET-scoped rules must also register on HEAD, otherwise a
  // method-scoped gate (e.g. `GET /admin/**: { basicAuth }`) is bypassable with
  // a HEAD request that still reaches the handler. Materialized here (rather
  // than as a lookup-time method rewrite) so the layers stay ordered by
  // specificity, explicit `HEAD /...` rules keep overriding the GET ones, and
  // both the runtime matcher and compiled codegen (which shares this router)
  // inherit it.
  for (const methods of byPath.values()) {
    const get = methods.get("GET");
    if (get) {
      methods.set("HEAD", [...get, ...(methods.get("HEAD") || [])]);
    }
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
  // Inject the *exact* (`compareRoutes`-based) specificity guard here: this
  // matcher already carries the rou3 router, so precision is free — while
  // createMatcherFromFind's own default stays dependency-free, keeping rou3 out
  // of compiled bundles. Either way a canonical reading can only override with
  // an equal-or-more-specific pattern, never downgrade.
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

// Segment syntax the shape guard below cannot reason about (regex / partial /
// escaped params) — such a segment only ever matches itself, literally.
const OPAQUE_SEGMENT_RE = /[()\\]/;

// A concrete (non-pattern) segment: matches exactly itself, so any
// single-segment param contains it.
const CONCRETE_SEGMENT_RE = /^[^:*()\\]+$/;

/**
 * Dependency-free default for {@link createMatcherFromFind}: the same
 * fail-closed question as {@link canOverrideRoute} ("is every path matching
 * `incomingRoute` also matched by `currentRoute`?") decided by comparing
 * pattern shapes instead of calling rou3's `compareRoutes`.
 *
 * Why not `compareRoutes`: a compiled matcher (`h3/rules/compiler`) exists to
 * keep the rou3 router out of the runtime bundle, and referencing
 * `compareRoutes` from the default would drag ~6 KB of rou3 back into every
 * compiled bundle (pinned by `test/rules/treeshake.test.ts`). The runtime
 * matcher — which already carries rou3 — injects the exact predicate, and
 * `compileRouteRules({ matcher })` bakes the exact relation as a static table,
 * so both keep full precision.
 *
 * **Sound, deliberately conservative**: it allows only containment it can
 * prove, so it can never permit an override `compareRoutes` would reject
 * (verified against rou3 as an oracle in `test/rules/match.test.ts`). Where it
 * cannot decide — a named catch-all (`**:rest`), a regex/partial param, an
 * empty (`//`, trailing-slash) segment, or a `**` with nothing to absorb — it
 * keeps the rule the served path resolved, which is the pre-guard status quo
 * for that pair.
 *
 * Exported for the soundness test only — not part of the `h3/rules` surface.
 */
export const canOverrideRouteShape: RouteOverridePredicate = (currentRoute, incomingRoute) => {
  if (currentRoute === incomingRoute) {
    return true;
  }
  const current = currentRoute.split("/");
  const incoming = incomingRoute.split("/");
  for (let i = 0; i < current.length; i++) {
    const cur = current[i]!;
    if (cur === "**") {
      // A trailing catch-all absorbs every remaining incoming segment — but
      // only when there is at least one to absorb (rou3 does not consistently
      // treat `x/**` as containing `x` itself, so that pair fails closed).
      return i === current.length - 1 && incoming.length > i;
    }
    const inc = incoming[i];
    if (inc === undefined) {
      return false;
    }
    if (cur === inc) {
      continue;
    }
    // A single-segment param contains any concrete segment; anything else
    // (another param, an empty segment, a catch-all) may be broader.
    if (
      (cur === "*" || (cur.startsWith(":") && !OPAQUE_SEGMENT_RE.test(cur))) &&
      CONCRETE_SEGMENT_RE.test(inc)
    ) {
      continue;
    }
    return false;
  }
  return current.length === incoming.length;
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
 * {@link mergeMatchedRouteRules}) so a broader canonical pattern can never
 * downgrade a narrower rule the served path resolved. It **defaults to a
 * specificity guard** — the dependency-free `canOverrideRouteShape`, since a
 * compiled matcher must not pull rou3 back in; `createRouteRulesMatcher`
 * injects the exact `compareRoutes`-based one, and `compileRouteRules({ matcher })`
 * bakes the exact relation as a static table. Pass `() => true` to opt back
 * into the historical unconditional override.
 */
export function createMatcherFromFind(
  findRouteRules: FindRouteRules,
  canOverride: RouteOverridePredicate = canOverrideRouteShape,
): RouteRulesMatcher {
  return (method, pathname) => {
    // h3 dispatches on event.url.pathname as-is (already once-decoded — only %2f
    // and reserved characters stay opaque); the readings below are what keep a
    // rule matched on every spelling of the path a consumer can resolve.
    const rawLayers = findRouteRules(method, pathname);

    let altLayers: (RouteRuleLayer[] | undefined)[] | undefined;
    let hasAltMatch = false;
    const readings = alternateReadings(pathname);
    if (readings) {
      altLayers = [];
      for (const reading of readings) {
        const layers = findRouteRules(method, reading);
        if (layers?.length) {
          hasAltMatch = true;
        }
        altLayers.push(layers);
      }
    }

    if (!rawLayers?.length && !hasAltMatch) {
      // Fresh objects: only memoized results are documented shared/read-only.
      return { routeRules: {}, routeRuleMiddleware: [] };
    }

    // Union the served path's resolution with each alternate reading's: a later
    // reading may add or override (never delete) a rule an earlier one resolved,
    // and override only when `canOverride` allows it — a broader alternate
    // pattern must never downgrade a narrower rule the served path resolved
    // (encoded-dot escalation). Proxy/redirect still forward the raw
    // `event.url.pathname`.
    const routeRules = mergeMatchedRouteRules(rawLayers, altLayers, canOverride);

    return { routeRules, routeRuleMiddleware: buildRouteRuleMiddleware(routeRules) };
  };
}

/**
 * Build the ordered middleware chain for a merged rule map: handlers run sorted
 * by `order` ascending (cors -3, basicAuth -2, headers -1, so a preflight is
 * answered before auth gates, auth gates before redirect/proxy, and headers
 * wrap the response). Skips sorting for 0/1 rules.
 *
 * Not part of the public `h3/rules` surface — shared with the `routeRules()`
 * middleware, which rebuilds the chain when it lifts a preflight `cors` rule so
 * ordering stays defined in exactly one place.
 */
export function buildRouteRuleMiddleware(
  routeRules: MatchedRouteRules,
): MatchResult["routeRuleMiddleware"] {
  const routeRuleMiddleware: MatchResult["routeRuleMiddleware"] = [];
  const matchedRules = Object.values(routeRules) as MatchedRouteRule[];
  const orderedRules = matchedRules.length > 1 ? matchedRules.sort(compareRuleOrder) : matchedRules;
  for (const rule of orderedRules) {
    // merged rule sets never contain `false` options (types.ts: MatchedRouteRule)
    if (!rule.handler) {
      continue;
    }
    routeRuleMiddleware.push(rule.handler.handler(rule));
  }
  return routeRuleMiddleware;
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

/**
 * Every spelling of `pathname` a rule must also be matched against, deduped and
 * excluding `pathname` itself (`undefined` when there is none). Ordered least →
 * most derived, which is the order they are unioned in.
 *
 * Three things make a path resolve differently downstream than it dispatches:
 *
 * - **An encoded separator** (`%2f`) must not dodge a rule the canonical path
 *   would hit (`admin%2fpanel` vs `admin/panel`) — an ordinary reverse proxy
 *   decodes it back.
 * - **An empty `//` segment** survives h3's canonical form but rou3 won't match
 *   it against `/admin/**`, so a slash-merging downstream (nginx
 *   `merge_slashes`) could reach a path whose gate never ran — hence the second,
 *   slash-merged reading (mirroring `isPathInScope`'s two interpretations).
 * - **A percent-encoded reserved character** (`%40` for `@`, and `%3b %26 %3d
 *   %2b %24 %2c`), or an escape the URL serializer re-adds (`%20`, non-ASCII):
 *   h3's pathname is `decodeURI`-d, which preserves all of them, while a rule
 *   pattern is written with the character itself (`/@admin/**`). Without the
 *   {@link decodedPath} reading, `/%40admin/...` walks past that gate and a
 *   proxied backend — or any consumer that decodes — serves it as `/@admin/...`.
 *   A consumer that decodes also *resolves*, so when the decoded path is not
 *   itself canonical it contributes its canonical readings rather than the
 *   intermediate spelling — which is also what catches a dot segment whose hex
 *   digits were themselves encoded (`%25%32%65` → `%2e` → `.`).
 *
 * Fast path: a pathname already canonical under the strictest reading is
 * canonical under every weaker one, and one with no `%` has nothing to decode,
 * so no reading can differ from the served path — an `includes("%")` and one
 * h3-owned scan (`isCanonicalPath` via `needsCanonicalPasses`, never a local
 * copy of the decode set, which would go stale silently) skip every resolve and
 * every extra lookup.
 */
function alternateReadings(pathname: string): string[] | undefined {
  const decoded = decodedPath(pathname);
  if (decoded === pathname && !needsCanonicalPasses(pathname)) {
    return; // Fast path: nothing to decode, and already canonical.
  }
  const readings: string[] = [];
  // The same treatment for each spelling: a spelling that is already canonical
  // is a reading in itself; one that is not contributes what it resolves to,
  // never the intermediate. A path that fails the guard pays both resolves —
  // see `mergedCanonicalPath` for why neither can be cheaply skipped.
  for (const spelling of decoded === pathname ? [pathname] : [pathname, decoded]) {
    if (!needsCanonicalPasses(spelling)) {
      pushReading(readings, pathname, spelling);
      continue;
    }
    const canonical = canonicalPath(spelling);
    pushReading(readings, pathname, canonical);
    // `undefined` when the merged reading agrees with `canonical`.
    const merged = mergedCanonicalPath(spelling, canonical);
    if (merged !== undefined) {
      pushReading(readings, pathname, merged);
    }
  }
  return readings.length > 0 ? readings : undefined;
}

// Skip a reading that is the served path itself (already resolved) or a
// duplicate of one already queued — each costs a router lookup.
function pushReading(readings: string[], pathname: string, reading: string): void {
  if (reading !== pathname && !readings.includes(reading)) {
    readings.push(reading);
  }
}

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
