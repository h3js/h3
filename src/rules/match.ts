import { addRoute, compareRoutes, createRouter, findAllRoutes } from "rou3";
import type { RouterContext } from "rou3";
import { parseRouteKey } from "./internal/key.ts";
import { mergeMatchedRouteRules } from "./merge.ts";
import type { RouteOverridePredicate, RouteRuleEntry, RouteRuleLayer } from "./merge.ts";
import { preMergeRuleLayers, routeContainmentRanks } from "./internal/premerge.ts";
import type { PreMergedRouteRules } from "./internal/premerge.ts";
import { ruleHandlers } from "./handlers/index.ts";
import { alternatePathReadings, recaseEscapes } from "./readings.ts";
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
   * oldest entry not hit since the eviction hand last passed it is evicted
   * (SIEVE). `0` (or negative) disables memoization.
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
  const registrations: [method: string, full: string, entries: RouteRuleEntry[]][] = [];
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
    registrations.push([method, registeredPattern(base + path), entries]);
  }
  // Grouped (and ranked / pre-merged below) by the pattern as registered:
  // recasing a mixed pattern (`registeredPattern`) can make keys disjoint as
  // written overlap, or coincide, once registered. Keyed without the base — as
  // HEAD does, so chain routes and `paramRoutes` compare against `entry.route`
  // — whenever every pattern is registered under one base spelling, which is
  // always the case unless the `baseURL` is written with lowercase hex (only a
  // recased pattern then uppercases it). Otherwise patterns under different
  // base spellings never meet in one lookup, so they are keyed by the full
  // pattern and analyzed as the disjoint patterns they are.
  const baseSpelling = registrations[0]?.[1].slice(0, base.length) ?? base;
  const oneBase = registrations.every(([, full]) => full.startsWith(baseSpelling));
  const prefix = oneBase ? baseSpelling : "";
  const byPath = new Map<string, Map<string, RouteRuleEntry[]>>();
  for (const [method, full, entries] of registrations) {
    const pattern = full.slice(prefix.length);
    for (const entry of entries) {
      entry.route = full.slice(base.length);
    }
    let methods = byPath.get(pattern);
    if (!methods) {
      byPath.set(pattern, (methods = new Map()));
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
    for (const [pattern, methods] of preMergeRuleLayers(byPath)) {
      for (const [method, data] of methods) {
        // The layer's route is compared with its rules' `route`/`paramRoutes`
        // (the key, without the base) when params are merged.
        data.route = (prefix + pattern).slice(base.length);
        addRuleRoute(router, method, prefix + pattern, data);
      }
    }
    return router;
  }
  // Specificity rank of each pattern, stamped onto its entries so `resolveLayers`
  // can merge matched layers broad → narrow without asking rou3 (or any
  // containment predicate) anything per request (see `RouteRuleEntry.rank`).
  // Stamped per pattern (not per registration): the HEAD materialization above
  // shares the GET entries, a registration *of the same pattern* under another
  // method, so the rank it carries is still its own pattern's containment depth.
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
  // rou3 pools a node's `""` and method-scoped registrations: a lookup for a
  // method sees both, ordered by specificity, with the method-scoped layer last
  // (so it overrides) between equally-specific ones.
  for (const [pattern, methods] of byPath) {
    for (const [method, entries] of methods) {
      addRuleRoute(router, method, prefix + pattern, entries);
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

// A whole-segment param in rou3's grammar (`:name`, optionally `?`/`+`/`*`):
// it contains any concrete segment. Anything else starting with `:` — a
// partial-segment param (`:name.:ext`, `:id-x`), a regex or an escape — matches
// only some segments, so the shape guard cannot reason about it.
const WHOLE_PARAM_SEGMENT_RE = /^:[A-Za-z_]\w*[?+*]?$/;

// A concrete (non-pattern) segment: matches exactly itself, so any
// single-segment param contains it. Group syntax (`{x}`) is excluded — an
// optional group (`/a/{lang}?`) also matches the empty segment, which a plain
// `:param` does not, making it partial rather than contained.
const CONCRETE_SEGMENT_RE = /^[^:*(){}\\]+$/;

// A `.`/`..` segment, in any spelling rou3 resolves (`%2e`).
const DOT_SEGMENT_RE = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

// Group syntax anywhere in a pattern — see `canOverrideRouteShape`.
const GROUP_RE = /[{}]/;

/**
 * Conservatively test route containment without importing rou3. Ambiguous
 * pattern shapes return `false` so alternate path readings cannot weaken rules.
 * @internal
 */
export const canOverrideRouteShape: RouteOverridePredicate = (currentRoute, incomingRoute) => {
  // Rule keys resolve dot segments like routes (`decodeRoutePattern`), so the
  // matcher never passes one; a direct caller's `.`/`..` fails closed.
  if (DOT_SEGMENT_RE.test(currentRoute) || DOT_SEGMENT_RE.test(incomingRoute)) {
    return false;
  }
  if (currentRoute === incomingRoute) {
    return true;
  }
  // A group (`{b}?`) keeps its own `/` when empty, so even an identical group
  // segment is not a reliable anchor: `/a/{b}?/:x?` matches `/a`, which
  // `/a/{b}?/**` does not. Fail closed on any group.
  if (GROUP_RE.test(currentRoute) || GROUP_RE.test(incomingRoute)) {
    return false;
  }
  const current = currentRoute.split("/");
  const incoming = incomingRoute.split("/");
  for (let i = 0; i < current.length; i++) {
    const cur = current[i]!;
    if (cur === "**") {
      // A trailing catch-all absorbs every remaining incoming segment — but
      // only when there is at least one to absorb (rou3 does not consistently
      // treat `x/**` as containing `x` itself, so that pair fails closed).
      // Nor after any interior empty segment, where rou3 matches neither `//`
      // itself nor an empty optional param (`//**` vs `//:y?`), and a later
      // optional param can vanish too (`/a//:q?/**` vs `/a//:q?/:s*`, which
      // matches `/a`).
      return i === current.length - 1 && incoming.length > i && !current.slice(1, i).includes("");
    }
    const inc = incoming[i];
    if (inc === undefined) {
      return false;
    }
    if (cur === inc) {
      continue;
    }
    // A param (or a `*`, which spans one segment or more) contains any concrete
    // segment; anything else (another param, an empty segment, a catch-all)
    // may be broader.
    if ((cur === "*" || WHOLE_PARAM_SEGMENT_RE.test(cur)) && CONCRETE_SEGMENT_RE.test(inc)) {
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
    const readings = alternatePathReadings(pathname);
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

interface MemoEntry {
  key: string;
  result: MatchResult;
  /** Set on every hit, cleared by the hand — one hit buys one sweep's reprieve. */
  visited: boolean;
}

/**
 * Memoize matches by method and pathname with a 1024-entry cap by default.
 * Returned objects are shared and must be treated as immutable.
 *
 * Eviction is SIEVE: insertion-ordered like a FIFO, but an entry hit since the
 * hand last passed it survives that pass. Plain FIFO evicts a hot static path
 * on the same schedule as the one-shot dynamic paths that displaced it, so a
 * mixed workload (a small hot set plus high-cardinality `/:id` traffic) loses
 * cached entries it is about to ask for again. Unlike LRU this costs no map
 * mutation on a hit — only a boolean store — which keeps the hot path the
 * single lookup the memo exists to provide.
 */
export function memoizeRouteRulesMatcher(
  matcher: RouteRulesMatcher,
  opts?: MatcherMemoizeOptions,
): RouteRulesMatcher {
  const max = opts?.max ?? 1024;
  if (max <= 0) {
    return matcher;
  }
  const memo = new Map<string, MemoEntry>();
  // The hand: a live Map iterator walking oldest → newest. Map iterators skip
  // entries deleted behind them and see entries appended ahead of them, so it
  // holds its place across evictions without a linked list or a second
  // structure. Exhausted means it reached the newest entry — wrap to the oldest.
  let hand: MapIterator<MemoEntry> | undefined;
  // Amortized O(1): each `visited` set costs at most one clearing step here.
  const evict = (): void => {
    for (;;) {
      let next = hand?.next();
      if (!next || next.done) {
        hand = memo.values();
        next = hand.next();
        if (next.done) {
          // Unreachable from the call site (only called at `size >= max >= 1`),
          // but the loop must not spin on an empty map.
          return;
        }
      }
      const entry = next.value;
      if (entry.visited) {
        entry.visited = false; // Reprieve spent; the next pass evicts it.
      } else {
        memo.delete(entry.key);
        return;
      }
    }
  };
  return (method, pathname) => {
    const key = method + " " + pathname;
    const entry = memo.get(key);
    if (entry) {
      entry.visited = true;
      return entry.result;
    }
    // Resolve before evicting so a throwing matcher costs no cached entry.
    const result = matcher(method, pathname);
    if (memo.size >= max) {
      evict();
    }
    memo.set(key, { key, result, visited: false });
    return result;
  };
}

// Text rou3 itself percent-encodes, in uppercase, when it registers a pattern:
// its `encodeLiteral` set (`[\0- "#<>?^`{}\x7F-\uFFFC]`) as it can appear in
// literal text — `?`, `{` and `}` are syntax unless escaped (`\?`, `\{`,
// `\}`). Keys are already encoded by `normalizeRoute` except for `^` and those
// escapes; a raw `baseURL` can carry any of it.
// eslint-disable-next-line no-control-regex -- encoded controls count too
const ROU3_ENCODED_RE = /[\0- "#<>^`\x7F-\uFFFF]|\\[{}?]/;

// A percent-escape spelled with a lowercase / an uppercase hex letter.
const LOWER_HEX_ESCAPE_RE = /%(?:[a-f][\da-fA-F]|[\dA-F][a-f])/;
const UPPER_HEX_ESCAPE_RE = /%(?:[A-F][\da-fA-F]|[\da-f][A-F])/;

/**
 * The pattern a rule is registered under: its `baseURL` plus normalized key,
 * as written — so it matches its route's own spelling directly — unless its
 * escapes mix hex cases (a `baseURL` in the other case than the key, or a raw
 * character, which normalization encodes uppercase, next to a lowercase
 * escape, or text rou3 encodes in uppercase itself — `^`, `\{`, a raw `baseURL`).
 * A mix is only reached by that exact spelling, since every recased
 * reading recases the whole path, so such a pattern is registered uppercased:
 * the browser's spelling then matches it directly, and the exact mixed spelling
 * through the uppercase reading (union-only — a restricting rule is re-added).
 * A pattern with a regex constraint stays exact: recasing an escape there
 * would change the regex.
 */
function registeredPattern(pattern: string): string {
  return LOWER_HEX_ESCAPE_RE.test(pattern) &&
    (UPPER_HEX_ESCAPE_RE.test(pattern) || ROU3_ENCODED_RE.test(pattern)) &&
    !hasConstraint(pattern)
    ? recaseEscapes(pattern, true)
    : pattern;
}

/** Whether `pattern` has a regex constraint: an unescaped `(` (`\(` is literal). */
function hasConstraint(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c === 92 /* \ */) {
      i++;
    } else if (c === 40 /* ( */) {
      return true;
    }
  }
  return false;
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

/**
 * `addRoute`, with rou3's parse errors re-thrown in h3's own voice, so an
 * unparseable rule key surfaces as an h3 rules error rather than a bare `rou3:`
 * (or raw `RegExp`) throw.
 */
function addRuleRoute<T>(router: RouterContext<T>, method: string, path: string, data: T): void {
  try {
    addRoute(router, method, path, data);
  } catch (error) {
    throw new Error(`[h3] rules: invalid route pattern \`${path}\`: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
