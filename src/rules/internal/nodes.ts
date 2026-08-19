import { routeNodeKeys } from "rou3";
import type { RouteRuleEntry } from "../merge.ts";

/**
 * Which methods each pattern's method-agnostic entries must **also** be
 * registered under, so no method-scoped registration can hide them.
 *
 * rou3 resolves `methods[method] || methods[""]` **per radix node**, and it
 * buckets by node, not by pattern text: `*`, `:id` and `:userId` all collapse
 * onto `node.param`, `**` and `**:rest` onto `node.wildcard`, `/admin` and
 * `/admin/` onto the same terminal node. So a single method-scoped registration
 * on a node hides *every* method-agnostic registration sharing that node — an
 * innocuous `GET /users/:id: { headers }` next to `/users/*: { auth }` (a
 * custom gate rule) silently deleted that gate for GET.
 *
 * `routeNodeKeys` makes that node identity observable (`routeNodeKeys(a)` and
 * `routeNodeKeys(b)` intersect iff `a` and `b` share a node), so the agnostic
 * copies can be placed exactly where a scoped registration could shadow them,
 * instead of on every method used anywhere in the rule set.
 *
 * Patterns are grouped by shared node, **transitively**: optional syntax
 * (`:x?`, `:x*`, `{…}?`) registers one pattern on several nodes, and registering
 * that pattern under a method reaches all of them — so a method that has to be
 * materialized for one of its nodes must be materialized for the whole group,
 * or the copy would shadow an agnostic registration on a sibling node. Within a
 * group every agnostic pattern is materialized onto the same method set, which
 * makes the invariant local and checkable: for any node and any method with a
 * scoped registration there, every agnostic entry on that node is registered
 * under that method too.
 *
 * The grouping is deliberately allowed to over-approximate (node keys erase
 * regex constraints and widen `**:name` to `**`, and a group is a transitive
 * closure): an extra copy only ever *adds* an agnostic layer where it would
 * already have applied via `methods[""]`, so over-merging is the fail-closed
 * direction. Under-approximating is what drops gates.
 *
 * Build-time only — the returned copies are registrations, so no matcher pays
 * anything per request.
 */
export function sharedNodeMethods(
  byPath: Map<string, Map<string, RouteRuleEntry[]>>,
): Map<string, Set<string>> {
  const parents = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parents.get(root) !== root) {
      root = parents.get(root)!;
    }
    return root;
  };

  const keysByPath = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    const keys = nodeKeys(path);
    keysByPath.set(path, keys);
    for (const key of keys) {
      if (!parents.has(key)) {
        parents.set(key, key);
      }
    }
    for (const key of keys) {
      const [a, b] = [find(keys[0]!), find(key)];
      if (a !== b) {
        parents.set(b, a);
      }
    }
  }

  const groupMethods = new Map<string, Set<string>>();
  for (const [path, methods] of byPath) {
    for (const method of methods.keys()) {
      if (!method) {
        continue;
      }
      const root = find(keysByPath.get(path)![0]!);
      let scoped = groupMethods.get(root);
      if (!scoped) {
        groupMethods.set(root, (scoped = new Set()));
      }
      scoped.add(method);
    }
  }
  if (groupMethods.size === 0) {
    return new Map();
  }

  const byPathMethods = new Map<string, Set<string>>();
  for (const [path, keys] of keysByPath) {
    const scoped = groupMethods.get(find(keys[0]!));
    if (scoped?.size) {
      byPathMethods.set(path, scoped);
    }
  }
  return byPathMethods;
}

/**
 * A pattern's node keys, with rou3's parse errors re-thrown in h3's own voice —
 * this is the first thing the router build asks of a pattern, so an unparseable
 * rule key surfaces here rather than as a bare `rou3:` (or raw `RegExp`) throw
 * from `addRoute` further down.
 */
function nodeKeys(path: string): string[] {
  let keys: string[];
  try {
    keys = routeNodeKeys(path);
  } catch (error) {
    throw new Error(`[h3] rules: invalid route pattern \`${path}\`: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return keys.length > 0 ? keys : [path];
}
