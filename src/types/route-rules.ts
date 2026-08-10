import type { MatchedRouteRule } from "../rules/types.ts";

/**
 * Rules matched for the current route.
 *
 * This interface declares only the rules built into `h3/rules` and is otherwise
 * intentionally open. It is the canonical extension point for route rules in the
 * h3 ecosystem: modules that implement or consume route rules (such as Nitro)
 * augment it via declaration merging, so that a single type describes the rules
 * of any h3 app regardless of which module declared them.
 *
 * Matched rules are exposed to handlers via `event.context.routeRules`, where they
 * are typed as `Readonly` — matchers are commonly memoized, so a matched object can
 * be shared between requests and must not be mutated in place.
 *
 * @example
 * ```ts
 * declare module "h3" {
 *   interface RouteRules {
 *     swr?: number | boolean;
 *     redirect?: string | { to: string; status?: number };
 *   }
 * }
 * ```
 */
export interface RouteRules {
  // The built-ins shipped by `h3/rules`. Each is listed explicitly rather than
  // spreading that module's `MatchedRouteRules`, which would contribute a
  // `string` **index signature** (its key union is `RouteRuleName`, i.e.
  // `string`, since `h3/rules`' own `RouteRules` config type stays open). On a
  // shared ecosystem interface that index signature is hostile: it makes every
  // other module's augmentation an error (`TS2411`), whatever key or type it
  // adds. Naming the keys also preserves each rule's `options` type, which the
  // mapped form widens to `unknown`. A consumer adding a custom rule declares
  // it the same way, via the augmentation shown above — that is what this
  // extension point is for.
  headers?: MatchedRouteRule<"headers">;
  redirect?: MatchedRouteRule<"redirect">;
  proxy?: MatchedRouteRule<"proxy">;
  cache?: MatchedRouteRule<"cache">;
  basicAuth?: MatchedRouteRule<"basicAuth">;
  cors?: MatchedRouteRule<"cors">;
}
