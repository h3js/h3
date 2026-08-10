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
}

/**
 * A matched rou3 layer: the entries registered for a pattern plus its params.
 * Data is either a plain entry array (merged per request) or a pre-merged layer
 * (`preMerge` mode — the most specific matched layer is the full result).
 */
export interface RouteRuleLayer {
  data: RouteRuleEntry[] | PreMergedRouteRules;
  params?: Record<string, string>;
}

/**
 * Multi-path merge + union: resolve the raw, canonical, and slash-merged
 * canonical paths independently (so a `false` reset stays local to its path),
 * then union in order — each later pass may **add or override, never delete**
 * a rule an earlier path resolved, and only overrides when `canOverride` allows
 * it (see {@link unionLayers}). Omitting `canOverride` keeps the historical
 * unconditional override.
 *
 * Pure: the caller supplies already-matched layers (least → most specific).
 */
export function mergeMatchedRouteRules(
  rawLayers: RouteRuleLayer[] | undefined,
  canonicalLayers?: RouteRuleLayer[] | undefined,
  mergedLayers?: RouteRuleLayer[] | undefined,
  canOverride?: RouteOverridePredicate,
): MatchedRouteRules {
  const routeRules = resolveLayers(rawLayers);
  unionLayers(routeRules, canonicalLayers, canOverride);
  unionLayers(routeRules, mergedLayers, canOverride);
  return routeRules;
}

// Union one alternate reading's resolved rules onto the accumulated set (each
// reading resolved on its own so its `false` resets stay local).
//
// Security: a later pass may **add** a rule the served path missed, but may
// **override** one only when `canOverride` allows it — the incoming pattern
// must be equal to, or strictly more specific than, the current one. This stops
// a broader canonical pattern (reachable via a crafted `%2e%2e` path that
// canonicalizes *up*) from downgrading a narrower rule (e.g. an auth gate) the
// served path already resolved. Not orderable (`disjoint`/`partial`) fails
// closed and keeps the served path's rule; omitting `canOverride` keeps the
// historical unconditional override.
function unionLayers(
  routeRules: MatchedRouteRules,
  layers: RouteRuleLayer[] | undefined,
  canOverride?: RouteOverridePredicate,
): void {
  if (!layers?.length) {
    return;
  }
  const resolved = resolveLayers(layers);
  for (const [name, rule] of Object.entries(resolved) as [string, MatchedRouteRule][]) {
    const current = routeRules[name as keyof MatchedRouteRules];
    if (current && canOverride && !canOverride(current.route, rule.route)) {
      continue;
    }
    mergeRouteRule(routeRules, name, rule, rule.params);
  }
}

// Resolve one path's matched layers (least → most specific); called per path
// so a `false` reset doesn't leak across paths.
function resolveLayers(layers: RouteRuleLayer[] | undefined): MatchedRouteRules {
  const lastData = layers?.[layers.length - 1]?.data;
  if (lastData && !Array.isArray(lastData)) {
    return resolvePreMergedLayers(layers!, lastData);
  }
  const routeRules = emptyRouteRules();
  for (const layer of layers || []) {
    for (const entry of layer.data as RouteRuleEntry[]) {
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

// preMerge mode: the matched layer already carries the merged chain result;
// only attach per-rule params here, merged from exactly the layers whose
// pattern contributed to that rule (`paramRoutes`).
function resolvePreMergedLayers(
  layers: RouteRuleLayer[],
  lastData: PreMergedRouteRules,
): MatchedRouteRules {
  const routeRules = emptyRouteRules();
  for (const entry of lastData.rules) {
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
