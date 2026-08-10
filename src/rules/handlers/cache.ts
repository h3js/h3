import { HTTPResponse } from "../../response.ts";
import type { EventHandler } from "../../types/handler.ts";
import type { CacheRuleOptions, RuleHandler } from "../types.ts";

/**
 * Wraps an event handler so its responses are cached. Core injection point —
 * `h3/rules` ships no caching implementation itself; the ocache-backed one
 * lives in `h3/rules/cache`, and consumers with their own conventions (e.g.
 * Nitro's unstorage) inject theirs here instead.
 *
 * `opts` is the merged rule options plus the generated `group`/`name` key.
 */
export type DefineCachedHandler = (handler: EventHandler, opts: CacheRuleOptions) => EventHandler;

/** Options for {@link createCacheRuleHandler}. */
export interface CacheRuleHandlerOptions {
  /** Creates the cached wrapper for a matched route handler. */
  defineCachedHandler: DefineCachedHandler;
  /** Default options merged into every cache rule (rule options win). */
  defaults?: CacheRuleOptions;
}

const CACHE_GROUP = "h3/route-rules";

/**
 * Create the `cache` rule handler for a matcher instance from an injected
 * `defineCachedHandler`. Memoization is instance-scoped (a closure `WeakMap`
 * keyed by the dispatched route handler, then by rule + route pattern), so each
 * matcher wraps a given route exactly once across requests. Keying by handler
 * identity keeps same-path routes of different methods — and same-path routes of
 * different apps sharing one handler instance, such as the module-scoped `cache`
 * export of `h3/rules/cache` — from resolving to each other's wrapper.
 *
 * The rule dispatches the route's **composed** handler (per-route
 * `middleware: [...]` plus the handler) and returns its result, so it never calls
 * `next()`. Consequence: global middleware registered *after* `routeRules()` does
 * not run for a route a cache rule matches — register `routeRules()` last.
 *
 * For the ready-made ocache-backed handler, use `h3/rules/cache` instead.
 */
export function createCacheRuleHandler(opts: CacheRuleHandlerOptions): RuleHandler<"cache"> {
  const defineCached = opts.defineCachedHandler;
  const defaults = opts.defaults;
  const cachedHandlers = new WeakMap<EventHandler, Map<string, EventHandler>>();

  return {
    handler: (m) =>
      function cacheRouteRule(event, next) {
        const matchedRoute = event.context.matchedRoute;
        if (!matchedRoute) {
          return next();
        }
        // `~composed` is h3's cached `middleware` + `handler` pair for the route,
        // built before any middleware runs (`routeHandler`, `src/h3.ts`). It is
        // absent for routes without per-route middleware — fall back to `handler`.
        const handler = matchedRoute["~composed"] ?? matchedRoute.handler;
        const key = `${m.route}:${matchedRoute.route}`;
        let byRoute = cachedHandlers.get(handler);
        if (!byRoute) {
          byRoute = new Map();
          cachedHandlers.set(handler, byRoute);
        }
        let cachedHandler = byRoute.get(key);
        if (!cachedHandler) {
          cachedHandler = defineCached(handler, {
            group: CACHE_GROUP,
            name: key,
            ...defaults,
            ...m.options,
          });
          byRoute.set(key, cachedHandler);
        }
        const res = cachedHandler(event);
        return typeof (res as Promise<unknown>)?.then === "function"
          ? (res as Promise<unknown>).then(normalizeResult)
          : normalizeResult(res);
      },
  };
}

/**
 * The route handler has already been dispatched by the cached wrapper, so an
 * empty (`undefined`) result must not reach h3's `callLayer`: it reads that as
 * "unhandled", calls `next()` and dispatches the whole route a second time.
 * Reachable through ocache's `headersOnly` path, which returns the handler's own
 * return value raw (no `toResponse`).
 *
 * An empty `HTTPResponse` is the handled equivalent of a bare `undefined`:
 * `prepareResponse` still merges the staged `event.res` status and headers into
 * it, so post-response rules (`headers`) are unaffected.
 */
function normalizeResult(res: unknown): unknown {
  return res === undefined ? new HTTPResponse(null) : res;
}
