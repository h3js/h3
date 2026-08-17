import { compareRoutes } from "rou3";
import { mergeRuleOptions } from "../merge.ts";
import type { RouteRuleEntry } from "../merge.ts";

/**
 * Pre-merged registration data for one `(method, path)` pattern: the resolved
 * rule set of its subsumption chain (least → most specific, `false` resets
 * applied). The highest-{@link PreMergedRouteRules.rank | ranked} matched layer
 * is the complete result at match time — no per-request merging.
 */
export interface PreMergedRouteRules {
  /** The pattern this layer is registered at (params lookup key). */
  route: string;
  /**
   * Containment depth of {@link route}: how many patterns of the rule set
   * strictly subsume it. Any set of simultaneously matched patterns is a
   * containment chain (partial overlaps are rejected below), and depth
   * strictly increases along a chain — if `a` subsumes `b` then every subsumer
   * of `a` also subsumes `b`, plus `a` itself — so the most specific matched
   * layer is the one with the highest rank.
   *
   * Layer *position* cannot be used for this — see {@link RouteRuleEntry.rank}
   * for rou3's documented optional-syntax carve-out and what taking the last
   * layer costs. The chain-cleanliness check below cannot catch that case
   * either: those pairs are `subset`, not `partial`, so nothing throws and the
   * compiler's fail-safe fallback never fires.
   */
  rank: number;
  rules: PreMergedRouteRuleEntry[];
  /**
   * Rule names this chain reset with `false`, when any. The reset itself is
   * applied here at build time, so the resolved `rules` cannot show it — but the
   * cross-reading union has to tell "reset by this path" apart from "never
   * matched" to stop a broader alternate reading resurrecting a permission
   * (`mergeMatchedRouteRules`). Plain mode reads the same information off the
   * `false` entries it merges per request; recording it keeps both modes — and
   * the compiled table — resolving identically.
   */
  resets?: string[];
}

export interface PreMergedRouteRuleEntry extends RouteRuleEntry {
  /**
   * Patterns whose layers contributed to this rule (chain order), when different
   * from `[route]` — used to merge exact per-rule `params` from only the layers
   * that carried the rule.
   */
  paramRoutes?: string[];
}

interface ChainRule extends PreMergedRouteRuleEntry {
  paramRoutes: string[];
}

/**
 * Containment depth of every pattern in a rule set — how many other patterns
 * strictly subsume it — which is the specificity rank a matched layer is sorted
 * by (see `RouteRuleEntry.rank`). Same measure `preMergeRuleLayers` stamps as
 * {@link PreMergedRouteRules.rank}, computed here for the **plain** (non-preMerge)
 * registration, which is why it is deliberately *lenient* where preMerge is
 * strict: plain mode accepts partial overlaps (they add no depth to either side,
 * so the pair keeps rou3's order) and a pattern `compareRoutes` cannot analyze
 * only forfeits the ordering it could not prove, never the registration.
 *
 * Build-time only: the ranks it returns travel with the entries (and through the
 * compiler as a literal), so no matcher — runtime or compiled — pays for
 * containment analysis per request, and none of them needs `rou3` to order layers.
 */
export function routeContainmentRanks(paths: string[]): Map<string, number> {
  const ranks = new Map<string, number>(paths.map((path) => [path, 0]));
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const [a, b] = [paths[i]!, paths[j]!];
      let rel: ReturnType<typeof compareRoutes>;
      try {
        rel = compareRoutes(a, b);
      } catch {
        continue; // Unanalyzable pattern: no provable order, so assert none.
      }
      // `disjoint`/`partial`/`equal` add depth to neither side.
      if (rel === "superset") {
        ranks.set(b, ranks.get(b)! + 1);
      } else if (rel === "subset") {
        ranks.set(a, ranks.get(a)! + 1);
      }
    }
  }
  return ranks;
}

/**
 * Pre-merge grouped rule entries (`path → method → entries`) into per-`(method,
 * path)` resolved layers.
 *
 * Requires the pattern set to be **chain-clean** — every overlapping pair strictly
 * ordered by containment (rou3 `compareRoutes`); partial overlaps make "most
 * specific layer" ambiguous and throw. Method-scoped rules are materialized as a
 * `method × path` matrix so a broad method-scoped rule still reaches narrower
 * agnostic patterns via rou3's `methods[m] || methods[""]` fallback.
 */
export function preMergeRuleLayers(
  byPath: Map<string, Map<string, RouteRuleEntry[]>>,
): Map<string, Map<string, PreMergedRouteRules>> {
  const paths = [...byPath.keys()];

  // Validate chain-cleanness and collect each path's subsumers.
  const subsumers = new Map<string, string[]>(paths.map((path) => [path, []]));
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const [a, b] = [paths[i]!, paths[j]!];
      switch (compareRoutes(a, b)) {
        case "disjoint": {
          break;
        }
        case "equal": {
          throw new Error(
            `[h3] rules: preMerge: \`${a}\` and \`${b}\` match the same paths — merge them into one rule`,
          );
        }
        case "superset": {
          subsumers.get(b)!.push(a);
          break;
        }
        case "subset": {
          subsumers.get(a)!.push(b);
          break;
        }
        case "partial": {
          throw new Error(
            `[h3] rules: preMerge: \`${a}\` and \`${b}\` partially overlap — the most specific match is ambiguous. Split the overlap into explicit rules or disable preMerge.`,
          );
        }
      }
    }
  }

  const methodsUsed = new Set<string>();
  for (const methods of byPath.values()) {
    for (const method of methods.keys()) {
      if (method) {
        methodsUsed.add(method);
      }
    }
  }

  const result = new Map<string, Map<string, PreMergedRouteRules>>();
  for (const path of paths) {
    // Containment is a strict total order in-chain, and containment depth (a
    // pattern's subsumer count) is a consistent numeric key for it — broad →
    // narrow, self last. Depth is also what each layer carries as its `rank`, so
    // the chain order merged here and the layer picked at match time are decided
    // by the same measure (`findAllRoutes` position is not, see `rank`).
    const chainSubsumers = subsumers.get(path)!;
    const chain = [...chainSubsumers]
      .sort((a, b) => subsumers.get(a)!.length - subsumers.get(b)!.length)
      .concat(path);

    const registrations = new Map<string, PreMergedRouteRules>();
    for (const method of ["", ...methodsUsed]) {
      // Only needed when some chain member has rules for this method — otherwise
      // rou3's `methods[""]` fallback already resolves to the identical chain.
      if (method && !chain.some((route) => byPath.get(route)!.has(method))) {
        continue;
      }
      const merged = new Map<string, ChainRule>();
      const resets = new Set<string>();
      for (const route of chain) {
        const methods = byPath.get(route)!;
        // Same precedence as plain registration: agnostic first, then method-scoped overrides.
        const agnostic = methods.get("") || [];
        const scoped = (method && methods.get(method)) || [];
        for (const entry of [...agnostic, ...scoped]) {
          mergeChainRule(merged, entry, resets);
        }
      }
      // Register even when empty — an all-`false` resolution is itself the result.
      registrations.set(method, {
        route: path,
        rank: chainSubsumers.length,
        rules: [...merged.values()].map(({ paramRoutes, ...rule }) =>
          paramRoutes.length === 1 && paramRoutes[0] === rule.route
            ? rule
            : { ...rule, paramRoutes },
        ),
        // A name reset then re-added later in the chain is resolved, not reset.
        ...(resets.size > 0 && { resets: [...resets].filter((name) => !merged.has(name)) }),
      });
    }
    result.set(path, registrations);
  }
  return result;
}

// Chain-time equivalent of `mergeRouteRule`, additionally tracking which patterns contributed (for exact per-rule params).
function mergeChainRule(
  merged: Map<string, ChainRule>,
  entry: RouteRuleEntry,
  resets: Set<string>,
): void {
  if (entry.options === false) {
    resets.add(entry.name);
  }
  const current = merged.get(entry.name);
  if (current) {
    if (entry.options === false) {
      merged.delete(entry.name);
      return;
    }
    current.options = mergeRuleOptions(current.options, entry.options);
    current.route = entry.route;
    if (!current.paramRoutes.includes(entry.route)) {
      current.paramRoutes.push(entry.route);
    }
  } else if (entry.options !== false) {
    merged.set(entry.name, { ...entry, paramRoutes: [entry.route] });
  }
}
