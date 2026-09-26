import type { RouteRuleEntry } from "../merge.ts";

/**
 * Most conditions one method may be scoped to. Every combination of them is a
 * registration (`2^n - 1` per method), so the router stays bounded.
 */
export const MAX_CONDITIONS_PER_METHOD = 6;

/**
 * Materialize the registrations a method inherits from another, in place on
 * grouped rule entries (`path → method → entries`). Build-time only — every
 * derived method is an ordinary registration, so neither the runtime matcher
 * nor compiled codegen pays anything per request.
 *
 * **`HEAD` from `GET`.** HEAD is served by the GET handler (RFC 9110) — h3
 * falls back to the GET route in `~findRoute` and its middleware matcher treats
 * GET-scoped as HEAD-matching — so GET-scoped rules must also register on HEAD,
 * otherwise a method-scoped gate (e.g. `GET /admin/**: { auth }`) is bypassable
 * with a HEAD request that still reaches the handler. Materialized here (rather
 * than as a lookup-time method rewrite) so the layers stay ordered by
 * specificity, explicit `HEAD /...` rules keep overriding the GET ones, and
 * both the runtime matcher and compiled codegen (which shares this router)
 * inherit it. Condition rules follow the same rule (`GET:MD` → `HEAD:MD`).
 *
 * **Condition combinations from `METHOD`.** A request is looked up under its
 * method plus *every* condition it satisfies, as one composite method with the
 * names sorted (`GET:ANON:MD`) — see `createConditionResolver`. That lookup
 * replaces the base method's, so each combination must carry every rule the
 * base method would have matched, plus the rules of each condition in it: on
 * each pattern, `[...base, ...cond1, ...cond2]` in name order. rou3 resolves
 * `methods[m] || methods[""]` per node, so a pattern with base-method rules
 * but no registration for the combination would otherwise fall back to the
 * agnostic entries alone and silently drop the method-scoped ones (a
 * `GET /admin/**` gate). Applying every satisfied condition — not just one —
 * is what keeps one condition's rules from hiding another's gate. Condition
 * entries come last on a pattern, so they override the base method there,
 * while a more specific base-method pattern still overrides a broader
 * condition one — method scope and conditions select layers, they never
 * re-rank patterns.
 */
export function materializeDerivedMethods(
  byPath: Map<string, Map<string, RouteRuleEntry[]>>,
): void {
  const conditionsByMethod = new Map<string, Set<string>>();
  for (const methods of byPath.values()) {
    // Adding a HEAD key mid-iteration is safe: it never starts with `GET`.
    for (const [method, entries] of methods) {
      if (method === "GET" || method.startsWith("GET:")) {
        const head = "HEAD" + method.slice(3);
        methods.set(head, [...entries, ...(methods.get(head) || [])]);
      }
    }
    for (const method of methods.keys()) {
      const sep = method.indexOf(":");
      if (sep !== -1) {
        const base = method.slice(0, sep);
        let names = conditionsByMethod.get(base);
        if (!names) {
          conditionsByMethod.set(base, (names = new Set()));
        }
        names.add(method.slice(sep + 1));
      }
    }
  }
  for (const [method, names] of conditionsByMethod) {
    const sorted = [...names].sort();
    if (sorted.length > MAX_CONDITIONS_PER_METHOD) {
      throw new Error(
        `[h3] rules: \`${method}\` rules use ${sorted.length} conditions (${sorted.join(", ")}) — at most ${MAX_CONDITIONS_PER_METHOD} are supported per method`,
      );
    }
    const combinations = nonEmptySubsets(sorted);
    for (const methods of byPath.values()) {
      const base = methods.get(method);
      // Snapshot before the single-name combinations overwrite them.
      const own = sorted.map((name) => methods.get(`${method}:${name}`));
      for (const combination of combinations) {
        const layers = [base, ...combination.map((i) => own[i])];
        if (layers.some(Boolean)) {
          methods.set(
            `${method}:${combination.map((i) => sorted[i]).join(":")}`,
            layers.flatMap((entries) => entries || []),
          );
        }
      }
    }
  }
}

/** Every non-empty subset of `0..items.length - 1`, each in ascending order. */
function nonEmptySubsets(items: readonly unknown[]): number[][] {
  const subsets: number[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const subset: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (mask & (1 << i)) {
        subset.push(i);
      }
    }
    subsets.push(subset);
  }
  return subsets;
}
