import type { PreMergedRouteRules } from "./internal/premerge.ts";
import type { MatchedRouteRule, MatchedRouteRules } from "./types.ts";

/**
 * Whether an alternate (canonical / slash-merged) reading may override an
 * already-resolved rule of the same name: true only when the incoming pattern
 * is equal to, or strictly more specific than, the current one. Injected (not
 * imported) so `merge.ts` stays `rou3`-free and tree-shakeable; omitted keeps
 * the historical unconditional-override behavior.
 */
export type RouteOverridePredicate = (currentRoute: string, incomingRoute: string) => boolean;

/**
 * A single rule entry as stored in the matcher (one per rule name of a pattern).
 * This is the unit produced by exploding a normalized `RouteRules` object and the
 * shape carried in each rou3 layer's `.data` array (also emitted by the compiler).
 *
 * `name` is needed here (unlike on {@link MatchedRouteRule}, where it is the map
 * key) because layer data is a flat array. There is no `method`: the config key's
 * method scope is consumed at registration time (which `(method, path)` node the
 * entry lands on), so carrying it per entry would be dead weight.
 */
export interface RouteRuleEntry {
  name: string;
  route: string;
  options: unknown;
  handler?: MatchedRouteRule["handler"];
  /**
   * Specificity rank of {@link route}: how many patterns of the rule set strictly
   * subsume it (`routeContainmentRanks`, stamped at router-build time and emitted
   * by the compiler). Absent means `0` — nothing subsumes it, or the registration
   * predates ranking. Every entry of a layer shares one pattern, so they all
   * carry the same rank.
   *
   * **Canonical note on layer ordering — the rest of `src/rules` points here.**
   * Matched layers are resolved in ascending rank, *never* in the order
   * `findAllRoutes` returned them. That order is containment order for plain
   * patterns, but **not** for rou3's modifier params: `GET /admin` against
   * `{"/admin", "/admin/:page?"}` yields the *broader* `:page?` layer last (both
   * weigh 0 in rou3's `pushSorted`, so config order survives), and
   * `/api/*​/:path*` comes back after the `/api/*​/**` it subsumes whatever the
   * registration order. Resolved in that order, the broader pattern is applied
   * last and wins — its options override the narrower pattern's, and its `false`
   * reset deletes the narrower pattern's rule outright, so an auth gate written
   * on the narrower pattern simply disappears.
   *
   * This is rou3's documented behavior, not a bug to wait out: its README
   * "Result ordering" scopes subsumption consistency to patterns *without*
   * optional syntax, and carves out `:name?` / `:name*` / `{...}?` explicitly —
   * such a pattern registers one entry per expansion, and results are ordered by
   * the specificity of the entry that *matched*, not by the breadth of the whole
   * pattern. The carve-out closes by telling consumers who need a pattern-level
   * containment order to re-sort the result with `compareRoutes` themselves,
   * which is exactly what ranking does — once, at build time.
   *
   * Consumers: {@link orderedLayers} (plain mode, per reading),
   * `PreMergedRouteRules.rank` (preMerge mode, where the highest matched rank is
   * the whole result) and `serializeRouteRuleEntries` (which must emit it).
   */
  rank?: number;
}

/**
 * A matched rou3 layer: the entries registered for a pattern plus its params.
 * Data is either a plain entry array (merged per request) or a pre-merged layer
 * (`preMerge` mode — the highest-`rank` matched layer is the full result).
 */
export interface RouteRuleLayer {
  data: RouteRuleEntry[] | PreMergedRouteRules;
  params?: Record<string, string>;
}

/**
 * Multi-path merge + union: resolve the served path and each **alternate
 * reading** of it (canonical, slash-merged, percent-decoded — see
 * `createMatcherFromFind`) independently, so a `false` reset stays local to its
 * reading, then union in order — each later reading may **add or override,
 * never delete** a rule an earlier one resolved, and only overrides when
 * `canOverride` allows it (see {@link unionLayers}). Omitting `canOverride`
 * keeps the historical unconditional override.
 *
 * Pure: the caller supplies each reading's matched layers, and decides which
 * readings exist — `altLayers` entries may be `undefined` (a reading that
 * resolved nothing, or one skipped as identical to an earlier one). Layers do
 * **not** have to arrive least → most specific: each reading's own layers are
 * re-ordered by their build-time specificity rank (see {@link resolveLayers}).
 * `canOverride` governs only the *cross-reading* union.
 */
export function mergeMatchedRouteRules(
  rawLayers: RouteRuleLayer[] | undefined,
  altLayers?: readonly (RouteRuleLayer[] | undefined)[],
  canOverride?: RouteOverridePredicate,
): MatchedRouteRules {
  // Names some reading resolved to `false`. A reset is applied as a deletion, so
  // without this the union cannot tell "this path explicitly exempted the rule"
  // from "the rule never matched here" — and takes the unguarded add branch.
  const resets = new Set<string>();
  const routeRules = resolveLayers(rawLayers, resets);
  for (const layers of altLayers || []) {
    unionLayers(routeRules, layers, canOverride, resets);
  }
  return routeRules;
}

// Union one alternate reading's resolved rules onto the accumulated set (each
// reading resolved on its own so its `false` resets stay local).
//
// Security: a later reading may **add** a rule the served path missed — this is
// what makes an auth gate written `/@admin/**` also cover the `/%40admin/...`
// spelling a decoding downstream resolves back to it — but may **override** one
// only when `canOverride` allows it: the incoming pattern must be equal to, or
// strictly more specific than, the current one. This stops a broader alternate
// pattern (reachable via a crafted `%2e%2e` path that canonicalizes *up*, or a
// decoded reading that lands on a laxer rule) from downgrading a narrower rule
// (e.g. an auth gate) the served path already resolved. Not orderable (`disjoint`/`partial`) fails
// closed and keeps the served path's rule; omitting `canOverride` keeps the
// historical unconditional override.
function unionLayers(
  routeRules: MatchedRouteRules,
  layers: RouteRuleLayer[] | undefined,
  canOverride?: RouteOverridePredicate,
  resets?: Set<string>,
): void {
  if (!layers?.length) {
    return;
  }
  const resolved = resolveLayers(layers, resets);
  for (const [name, rule] of Object.entries(resolved) as [string, MatchedRouteRule][]) {
    const current = routeRules[name as keyof MatchedRouteRules];
    if (current) {
      if (canOverride && !canOverride(current.route, rule.route)) {
        continue;
      }
    } else if (resets?.has(name) && !rule.handler?.restricting) {
      // Reset by an earlier reading, and re-adding this rule could only loosen
      // the response — honor the exemption. A restriction is fail-closed and
      // still re-added (see `RuleHandler.restricting`), which is what keeps a
      // single-segment `<gate>: false` from covering a path that decodes to
      // more segments than the pattern granting it.
      continue;
    }
    mergeRouteRule(routeRules, name, rule, rule.params);
  }
}

// Resolve one path's matched layers into a rule set; called per reading so a
// `false` reset doesn't leak across readings. Layers are re-ordered broad →
// narrow first (see {@link orderedLayers}).
function resolveLayers(
  layers: RouteRuleLayer[] | undefined,
  resets?: Set<string>,
): MatchedRouteRules {
  // A router is built entirely in one mode, so the first layer decides which:
  // an entry array merges layer by layer, a pre-merged layer already carries
  // its whole chain and is selected by rank (never by position — see
  // `PreMergedRouteRules.rank`).
  const firstData = layers?.[0]?.data;
  if (firstData && !Array.isArray(firstData)) {
    return resolvePreMergedLayers(layers!, resets);
  }
  const routeRules = emptyRouteRules();
  for (const layer of orderedLayers(layers)) {
    for (const entry of layer.data as RouteRuleEntry[]) {
      if (entry.options === false) {
        resets?.add(entry.name);
      }
      mergeRouteRule(routeRules, entry.name, entry, layer.params);
    }
  }
  return routeRules;
}

// `typeof null === "object"` — without this guard a `null` option would
// spread-merge into (not override) an inherited object. Shared with premerge.
export function isMergeableObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

// Rule names are attacker-influenceable config (they become property keys). A
// null prototype keeps `__proto__`/`constructor`/`prototype` plain own keys —
// otherwise `routeRules["__proto__"]` reads the inherited `Object.prototype`
// getter (truthy) and `mergeRouteRule`'s update branch would assign directly
// onto `Object.prototype` — a process-wide prototype-pollution DoS.
function emptyRouteRules(): MatchedRouteRules {
  return Object.create(null) as MatchedRouteRules;
}

// THE core option-merge rule, shared by every merge site (runtime layer merge
// below, build-time chain pre-merge in `src/rules/internal/premerge.ts`, and
// the canonical-key collision merge in `src/rules/normalize.ts`): objects shallow-merge
// with incoming keys winning; everything else overrides wholesale. The
// `false`-delete branch stays local to each caller. Not re-exported from
// `src/rules/index.ts`.
export function mergeRuleOptions(current: unknown, incoming: unknown): unknown {
  return isMergeableObject(current) && isMergeableObject(incoming)
    ? { ...current, ...incoming }
    : incoming;
}

// ------------------------------------------------------------------------
// Internal
// ------------------------------------------------------------------------

/**
 * Re-order a reading's matched layers broad → narrow, so resolution does not
 * depend on the order `findAllRoutes` happened to produce — that order is not
 * containment order for modifier params, and merging out of order drops gates
 * (see {@link RouteRuleEntry.rank}).
 *
 * A stable insertion sort on the entries' build-time {@link RouteRuleEntry.rank}
 * (containment depth, ascending). Deliberately **not** a containment predicate
 * evaluated here: ordering must not depend on a per-request comparison at all —
 * `createMatcherFromFind`'s dependency-free default (`canOverrideRouteShape`) is
 * conservative *and* not exact for modifier params, which is precisely the shape
 * this ordering exists for, so a compiled matcher without a baked predicate
 * would drop the very gates the rank preserves. A number decided once at build
 * time is exact for every matcher, costs nothing per request, and keeps `rou3`
 * out of compiled bundles. Equal ranks (incomparable patterns, or a registration
 * without ranks) keep the order `findAllRoutes` produced.
 */
function orderedLayers(layers: RouteRuleLayer[] | undefined): RouteRuleLayer[] {
  if (!layers || layers.length < 2) {
    return layers || [];
  }
  let ordered = layers;
  for (let i = 1; i < ordered.length; i++) {
    const layer = ordered[i]!;
    const rank = layerRank(layer);
    let j = i - 1;
    while (j >= 0 && layerRank(ordered[j]!) > rank) {
      // Copy on the first move only — an already-ordered set (the common case)
      // allocates nothing, and the caller's array is never mutated.
      if (ordered === layers) {
        ordered = [...layers];
      }
      ordered[j + 1] = ordered[j]!;
      j--;
    }
    if (j + 1 !== i) {
      ordered[j + 1] = layer;
    }
  }
  return ordered;
}

// Every entry of a layer shares one pattern, so the first one carries the
// layer's rank. An empty layer (a rule object with no entries) contributes
// nothing either way.
function layerRank(layer: RouteRuleLayer): number {
  return (layer.data as RouteRuleEntry[])[0]?.rank ?? 0;
}

// preMerge mode: the matched layer already carries the merged chain result;
// only attach per-rule params here, merged from exactly the layers whose
// pattern contributed to that rule (`paramRoutes`).
//
// The complete result is the *most specific* matched layer, which is the
// highest-ranked one and not necessarily the last one (`PreMergedRouteRules.rank`,
// and {@link RouteRuleEntry.rank} for why position is unusable). Sorting by rank
// (rather than scanning for the maximum) also puts the per-rule `params` merge
// below in broad → narrow order, so a narrower contributor's params win.
function resolvePreMergedLayers(
  rawLayers: RouteRuleLayer[],
  resets?: Set<string>,
): MatchedRouteRules {
  const layers =
    rawLayers.length < 2
      ? rawLayers
      : [...rawLayers].sort(
          (a, b) => (a.data as PreMergedRouteRules).rank - (b.data as PreMergedRouteRules).rank,
        );
  const routeRules = emptyRouteRules();
  const winning = layers[layers.length - 1]!.data as PreMergedRouteRules;
  if (resets && winning.resets) {
    for (const name of winning.resets) {
      resets.add(name);
    }
  }
  for (const entry of winning.rules) {
    const paramRoutes = entry.paramRoutes;
    let params: Record<string, string> | undefined;
    for (const layer of layers) {
      const layerParams = layer.params;
      if (!layerParams) {
        continue;
      }
      const layerRoute = (layer.data as PreMergedRouteRules).route;
      if (paramRoutes ? paramRoutes.includes(layerRoute) : layerRoute === entry.route) {
        // rou3 gives fresh params per lookup — safe to reuse directly for a single contributor.
        params = params ? { ...params, ...layerParams } : layerParams;
      }
    }
    routeRules[entry.name as keyof MatchedRouteRules] = {
      route: entry.route,
      options: entry.options,
      handler: entry.handler,
      params,
    } as never;
  }
  return routeRules;
}

// Apply one rule onto the accumulated set: `false` resets an inherited rule;
// otherwise options merge/override with the incoming (more specific/later)
// rule winning, and `route`/`params` always take the more specific match.
function mergeRouteRule(
  routeRules: MatchedRouteRules,
  ruleName: string,
  rule: Omit<RouteRuleEntry, "name">,
  params: Record<string, string> | undefined,
): void {
  const name = ruleName as keyof MatchedRouteRules;
  const currentRule = routeRules[name];
  if (currentRule) {
    if (rule.options === false) {
      delete routeRules[name];
      return;
    }
    currentRule.options = mergeRuleOptions(currentRule.options, rule.options) as never;
    currentRule.route = rule.route;
    if (currentRule.params || params) {
      currentRule.params = { ...currentRule.params, ...params };
    }
  } else if (rule.options !== false) {
    // Built explicitly (not spread) so a `RouteRuleEntry`'s `name` does not leak
    // onto the matched rule — the map key is the name.
    routeRules[name] = {
      route: rule.route,
      options: rule.options,
      handler: rule.handler,
      params,
    } as never;
  }
}
