import { callMiddleware } from "../middleware.ts";
import type { Middleware } from "../types/handler.ts";
import { createRouteRulesMatcher, memoizeRouteRulesMatcher } from "./match.ts";
import type { MatcherMemoizeOptions, RouteRulesMatcherOptions } from "./match.ts";
import { normalizeRouteRules } from "./normalize.ts";
import type { RouteRuleConfig } from "./types.ts";

// The built-in rules are declared on h3's own `RouteRules` interface (the type
// behind `event.context.routeRules`) in `src/types/route-rules.ts`, since rules
// now ship inside h3 — see the note there for why each key is named explicitly.

/** Options for the plug-and-play {@link routeRules} middleware. */
export interface RouteRulesOptions extends RouteRulesMatcherOptions {
  /**
   * Memoize match results per `method + pathname` (composes
   * {@link memoizeRouteRulesMatcher}) — **enabled by default**, FIFO-capped at
   * 1024 entries. Memoized results are shared across requests: treat
   * `event.context.routeRules` and its rule options as read-only. Pass `false`
   * to resolve every request from scratch (each request gets fresh result
   * objects), or an options object to tune the entry cap.
   * @default true
   */
  memoize?: boolean | MatcherMemoizeOptions;
}

/**
 * Plug-and-play H3 middleware: matches route rules for each request, exposes the
 * merged rule map as `event.context.routeRules`, and runs matched rule
 * middleware (redirect, proxy, headers, basic auth, cache, …) before the route
 * handler.
 *
 * Match results are memoized by default (see {@link RouteRulesOptions.memoize});
 * treat `event.context.routeRules` as read-only, or pass `memoize: false`.
 *
 * @example
 * ```ts
 * import { H3, serve } from "h3";
 * import { routeRules } from "h3/rules";
 * import { cache } from "h3/rules/cache"; // needed for cache/swr rules (ocache peer)
 *
 * const app = new H3();
 * app.use(
 *   routeRules(
 *     {
 *       "/blog/**": { swr: 60 },
 *       "/old/**": { redirect: { to: "/new/**", status: 301 } },
 *       "/api/**": { cors: true },
 *     },
 *     { handlers: { cache } },
 *   ),
 * );
 * ```
 */
export function routeRules(
  config: Record<string, RouteRuleConfig>,
  opts?: RouteRulesOptions,
): Middleware {
  // Composed here (not in createRouteRulesMatcher, which stays memoize-free so
  // matcher-only bundles can tree-shake the wrapper away) since this module
  // already imports the full core.
  const memoize = opts?.memoize ?? true;
  const matcher = createRouteRulesMatcher(normalizeRouteRules(config), opts);
  const match = memoize
    ? memoizeRouteRulesMatcher(matcher, memoize === true ? undefined : memoize)
    : matcher;
  return function routeRulesMiddleware(event, next) {
    const { routeRules, routeRuleMiddleware } = match(event.req.method, event.url.pathname);
    event.context.routeRules = routeRules;
    return routeRuleMiddleware.length > 0
      ? callMiddleware(event, routeRuleMiddleware, () => next())
      : next();
  };
}
