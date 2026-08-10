import { compareRoutes } from "rou3";
import { mergeRuleOptions } from "../merge.ts";
import type { RouteRuleEntry } from "../merge.ts";

/**
 * Pre-merged registration data for one `(method, path)` pattern: the resolved
 * rule set of its subsumption chain (least → most specific, `false` resets
 * applied). The most specific matched layer is the complete result at match
 * time — no per-request merging.
 */
export interface PreMergedRouteRules {
  /** The pattern this layer is registered at (params lookup key). */
  route: string;
  rules: PreMergedRouteRuleEntry[];
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
    // Containment is a strict total order in-chain, matching rou3's findAllRoutes
    // layer order — sort broad → narrow, self last.
    const chain = [...subsumers.get(path)!]
      .sort((a, b) => (compareRoutes(a, b) === "superset" ? -1 : 1))
      .concat(path);

    const registrations = new Map<string, PreMergedRouteRules>();
    for (const method of ["", ...methodsUsed]) {
      // Only needed when some chain member has rules for this method — otherwise
      // rou3's `methods[""]` fallback already resolves to the identical chain.
      if (method && !chain.some((route) => byPath.get(route)!.has(method))) {
        continue;
      }
      const merged = new Map<string, ChainRule>();
      for (const route of chain) {
        const methods = byPath.get(route)!;
        // Same precedence as plain registration: agnostic first, then method-scoped overrides.
        const agnostic = methods.get("") || [];
        const scoped = (method && methods.get(method)) || [];
        for (const entry of [...agnostic, ...scoped]) {
          mergeChainRule(merged, entry);
        }
      }
      // Register even when empty — an all-`false` resolution is itself the result.
      registrations.set(method, {
        route: path,
        rules: [...merged.values()].map(({ paramRoutes, ...rule }) =>
          paramRoutes.length === 1 && paramRoutes[0] === rule.route
            ? rule
            : { ...rule, paramRoutes },
        ),
      });
    }
    result.set(path, registrations);
  }
  return result;
}

// Chain-time equivalent of `mergeRouteRule`, additionally tracking which patterns contributed (for exact per-rule params).
function mergeChainRule(merged: Map<string, ChainRule>, entry: RouteRuleEntry): void {
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
