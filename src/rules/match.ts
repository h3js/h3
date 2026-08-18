import { addRoute, compareRoutes, createRouter, findAllRoutes } from "rou3";
import type { RouterContext } from "rou3";
import { parseRouteKey } from "./internal/key.ts";
import { mergeMatchedRouteRules } from "./merge.ts";
import type { RouteOverridePredicate, RouteRuleEntry, RouteRuleLayer } from "./merge.ts";
import { sharedNodeMethods } from "./internal/nodes.ts";
import { preMergeRuleLayers, routeContainmentRanks } from "./internal/premerge.ts";
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
  NormalizedRouteRules,
  ResolvedRouteRules,
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
   * Registry defaults are `headers`, `redirect`, `cors`; `cache` and
   * `proxy` are opt-in (register them from `h3/rules/cache` / `h3/rules/proxy`).
   * Setting a name to `undefined` makes that rule data-only.
   */
  handlers?: RuleHandlers;
  /**
   * Pre-merge compatible pattern chains at startup. Throws for partial overlaps
   * or patterns that cannot be analyzed, such as regex parameters.
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
 * Register normalized rules in a rou3 router. Method-agnostic rules are merged
 * with method-scoped rules, and `GET` rules also apply to `HEAD`.
 */
export function createRulesRouter(
  rules: Record<string, NormalizedRouteRules>,
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
  // method-scoped gate (e.g. `GET /admin/**: { auth }`) is bypassable with
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
  // Specificity rank of each pattern, stamped onto its entries so `resolveLayers`
  // can merge matched layers broad → narrow without asking rou3 (or any
  // containment predicate) anything per request (see `RouteRuleEntry.rank`).
  // Stamped per pattern (not per registration) so it survives the duplication
  // below: the agnostic array is registered by reference under `""` and each
  // method materialized for it, and the HEAD materialization above shares the
  // GET entries — every copy is a registration *of the same pattern* under
  // another method, never of another pattern, so the rank a copy carries is
  // still its own pattern's containment depth.
  // preMerge returned above: there the chain is resolved at build time and the
  // rank lives on the pre-merged layer (`PreMergedRouteRules.rank`) instead.
  for (const [path, rank] of routeContainmentRanks([...byPath.keys()])) {
    if (rank === 0) {
      continue; // Nothing subsumes it — the default when the field is absent.
    }
    for (const entries of byPath.get(path)!.values()) {
      for (const entry of entries) {
        entry.rank = rank;
      }
    }
  }
  // Per pattern, the methods scoped on a node it shares — the only methods for
  // which a registration could hide its agnostic entries (HEAD included, having
  // been materialized above).
  const sharedMethods = sharedNodeMethods(byPath);
  // Pass 1 — agnostic entries, on `""` (the fallback for every method with no
  // registration on the node) and on each of those methods. Registering them
  // first keeps them ahead of the method-scoped layers of *any* pattern that
  // shares their node: rou3 pushes same-node/same-method registrations in
  // insertion order and its specificity sort is stable, so an equally-specific
  // method-scoped rule still overrides. Between *differently*-specific spellings
  // on one node (`/a/*` vs `/a/:id`) rou3's own sort decides, exactly as it does
  // for two agnostic patterns — method scope does not re-rank patterns, it only
  // selects which are matched.
  for (const [path, methods] of byPath) {
    const agnostic = methods.get("");
    if (!agnostic) {
      continue;
    }
    addRoute(router, "", base + path, agnostic);
    for (const method of sharedMethods.get(path) || []) {
      addRoute(router, method, base + path, agnostic);
    }
  }
  // Pass 2 — method-scoped entries.
  for (const [path, methods] of byPath) {
    for (const [method, entries] of methods) {
      if (method) {
        addRoute(router, method, base + path, entries);
      }
    }
  }
  return router;
}

/**
 * Create a route-rules matcher from a **normalized** rule set (see {@link normalizeRouteRules}).
 * Returns `(method, pathname) => { routeRules, matchedRules, routeRuleMiddleware }`.
 */
export function createRouteRulesMatcher(
  rules: Record<string, NormalizedRouteRules>,
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

// A param that can match *zero* segments (`:x?`, `:x*`). rou3 reads such a
// pattern as broader than the `**` that appears to absorb it (`/a/*​/:path*`
// matches `/a/x`, which `/a/*​/**` does not), so it must never be absorbed.
const ZERO_MATCHABLE_SEGMENT_RE = /^:.*[?*]$/;

/**
 * Conservatively test route containment without importing rou3. Ambiguous
 * pattern shapes return `false` so alternate path readings cannot weaken rules.
 * @internal
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
      // treat `x/**` as containing `x` itself, so that pair fails closed), and
      // only when none of them can match zero segments (which would make the
      // incoming pattern the broader one).
      return (
        i === current.length - 1 &&
        incoming.length > i &&
        !incoming.slice(i).some((segment) => ZERO_MATCHABLE_SEGMENT_RE.test(segment))
      );
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
 * Create a matcher from a `findAllRoutes`-compatible lookup, typically generated
 * by `h3/rules/compiler`.
 *
 * Results are not memoized. The default override guard fails closed when route
 * specificity is ambiguous.
 */
export function createMatcherFromFind(
  findRouteRules: FindRouteRules,
  canOverride: RouteOverridePredicate = canOverrideRouteShape,
): RouteRulesMatcher {
  return (method, pathname) => {
    // h3 dispatches on event.url.pathname as-is (needless escapes already
    // decoded — separators, `%25`, `%20`, non-ASCII and the controls stay
    // opaque); the readings below are what keep a rule matched on every spelling
    // of the path a consumer can resolve.
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
      return { routeRules: {}, matchedRules: {}, routeRuleMiddleware: [] };
    }

    // Broader alternate readings must not override narrower served-path rules.
    const matchedRules = mergeMatchedRouteRules(rawLayers, altLayers, canOverride);

    return {
      routeRules: toRouteRules(matchedRules),
      matchedRules,
      routeRuleMiddleware: buildRouteRuleMiddleware(matchedRules),
    };
  };
}

/** Project matched rules to their public options map using a pollution-safe prototype. */
function toRouteRules(matchedRules: MatchedRouteRules): ResolvedRouteRules {
  const routeRules = Object.create(null) as Record<string, unknown>;
  for (const name in matchedRules) {
    routeRules[name] = (matchedRules as Record<string, MatchedRouteRule>)[name]!.options;
  }
  return routeRules as ResolvedRouteRules;
}

/**
 * Build middleware ordered by handler `order` ascending, ties broken by rule
 * name.
 *
 * The tie-break is what makes the chain a property of the *rules* rather than of
 * how they were matched: key order here is the order rules were merged in, which
 * is normalize's fixed per-pattern order only when they all come from one
 * pattern — across patterns it is layer order (broad → narrow). A rule that
 * never calls `next()` swallows everything after it, so without a tie-break the
 * same rule set would behave differently depending on whether it was authored on
 * one pattern or split across two (a broad `cache` swallowing a narrow gate).
 * Sorting by name is arbitrary but total, and no built-in relies on it — the
 * ones whose relative position matters carry distinct explicit orders.
 */
export function buildRouteRuleMiddleware(
  matchedRules: MatchedRouteRules,
): MatchResult["routeRuleMiddleware"] {
  const routeRuleMiddleware: MatchResult["routeRuleMiddleware"] = [];
  const rules = Object.entries(matchedRules) as [string, MatchedRouteRule][];
  if (rules.length > 1) {
    rules.sort(compareRuleOrder);
  }
  for (const [, rule] of rules) {
    if (!rule.handler) {
      continue;
    }
    routeRuleMiddleware.push(rule.handler.handler(rule));
  }
  return routeRuleMiddleware;
}

/**
 * Memoize matches by method and pathname with a 1024-entry FIFO cap by default.
 * Returned objects are shared and must be treated as immutable.
 */
export function memoizeRouteRulesMatcher(
  matcher: RouteRulesMatcher,
  opts?: MatcherMemoizeOptions,
): RouteRulesMatcher {
  const max = opts?.max ?? 1024;
  if (max <= 0) {
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
 * - **An escape h3 serves opaque** — one the URL serializer would re-add (`%20`,
 *   non-ASCII, `%22 %3C %3E %5E %60 %7B %7D`), a C0 control, or `%25` at any
 *   nesting depth (`%2540`). h3's pathname decodes only the *needless* escapes
 *   (`canonicalPathname`, so `/%40admin` already arrives as `/@admin`), while a
 *   rule pattern is written with the character itself (`/a b/**`). Without the
 *   {@link decodedPath} reading, `/a%20b/...` walks past that gate and a proxied
 *   backend — or any consumer that decodes — serves it as `/a b/...`.
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
    return;
  }
  const readings: string[] = [];
  for (const spelling of decoded === pathname ? [pathname] : [pathname, decoded]) {
    if (!needsCanonicalPasses(spelling)) {
      pushReading(readings, pathname, spelling);
      continue;
    }
    const canonical = canonicalPath(spelling);
    pushReading(readings, pathname, canonical);
    const merged = mergedCanonicalPath(spelling, canonical);
    if (merged !== undefined) {
      pushReading(readings, pathname, merged);
    }
  }
  return readings.length > 0 ? readings : undefined;
}

function pushReading(readings: string[], pathname: string, reading: string): void {
  if (reading !== pathname && !readings.includes(reading)) {
    readings.push(reading);
  }
}

// Opt-in rules must not silently degrade to data-only rules.
function requireOptInHandler(
  rules: Record<string, NormalizedRouteRules>,
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

const compareRuleOrder = (a: [string, MatchedRouteRule], b: [string, MatchedRouteRule]): number =>
  orderWeight(a[1].handler) - orderWeight(b[1].handler) || (a[0] < b[0] ? -1 : 1);

function orderWeight(handler: RuleHandler | undefined): number {
  return handler?.order ?? 0;
}

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
