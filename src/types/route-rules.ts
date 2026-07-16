/**
 * Rules matched for the current route.
 *
 * This interface is intentionally empty. It is the canonical extension point for
 * route rules in the h3 ecosystem: modules that implement or consume route rules
 * (such as `h3-rules` or Nitro) augment it via declaration merging, so that a single
 * type describes the rules of any h3 app regardless of which module declared them.
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
export interface RouteRules {}
