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
 * `defineCachedHandler`. Memoization is instance-scoped (a closure `Map`), so
 * each matcher wraps a given route exactly once across requests.
 *
 * For the ready-made ocache-backed handler, use `h3/rules/cache` instead.
 */
export function createCacheRuleHandler(opts: CacheRuleHandlerOptions): RuleHandler<"cache"> {
  const defineCached = opts.defineCachedHandler;
  const defaults = opts.defaults;
  const cachedHandlers = new Map<string, EventHandler>();

  return {
    handler: (m) =>
      function cacheRouteRule(event, next) {
        if (!event.context.matchedRoute) {
          return next();
        }
        const { handler, route } = event.context.matchedRoute;
        const key = `${m.route}:${route}`;
        let cachedHandler = cachedHandlers.get(key);
        if (!cachedHandler) {
          cachedHandler = defineCached(handler, {
            group: CACHE_GROUP,
            name: key,
            ...defaults,
            ...m.options,
          });
          cachedHandlers.set(key, cachedHandler);
        }
        return cachedHandler(event);
      },
  };
}
