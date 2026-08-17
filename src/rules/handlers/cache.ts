import { HTTPResponse } from "../../response.ts";
import type { EventHandler } from "../../types/handler.ts";
import type { CacheRuleOptions, RuleHandler } from "../types.ts";

/** Wrap an event handler with an injected cache implementation. */
export type DefineCachedHandler = (handler: EventHandler, opts: CacheRuleOptions) => EventHandler;

/** Options for {@link createCacheRuleHandler}. */
export interface CacheRuleHandlerOptions {
  /** Creates the cached wrapper for a matched route handler. */
  defineCachedHandler: DefineCachedHandler;
  /** Default options merged into every cache rule (rule options win). */
  defaults?: CacheRuleOptions;
  /**
   * Stable cache-key scope. By default, a process-unique scope isolates apps
   * but prevents persistent cache sharing across processes.
   */
  id?: string;
}

const CACHE_GROUP = "h3/route-rules";

// Per-route-handler cache-key scope counter. Only ever appended to a key, never
// parsed; uniqueness within the process is the whole contract.
let scopeCounter = 0;

/**
 * Create a `cache` rule handler from an injected cache wrapper.
 *
 * Cache keys are isolated by handler, method, and route unless `id` or an
 * explicit cache `name` opts into sharing. Register `routeRules()` after global
 * middleware because a cache hit does not call downstream middleware.
 */
export function createCacheRuleHandler(opts: CacheRuleHandlerOptions): RuleHandler<"cache"> {
  const defineCached = opts.defineCachedHandler;
  const defaults = opts.defaults;
  const id = opts.id;
  const cachedHandlers = new WeakMap<
    EventHandler,
    { scope: string; byRoute: Map<string, EventHandler> }
  >();

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
        // The method is part of the key because h3 serves `HEAD` from the `GET`
        // route (one handler identity, one route pattern) while a `HEAD`
        // response is body-less by definition: sharing the entry lets a single
        // anonymous `HEAD` store an empty body that every later `GET` is then
        // served for the whole TTL. Only the two cacheable methods are told
        // apart — every other method bypasses caching, so one shared bucket for
        // them keeps an `app.all()` route from growing a wrapper per arbitrary
        // method token a client invents.
        const method = event.req.method;
        const key = `${method === "GET" || method === "HEAD" ? method : "*"}:${m.route}:${matchedRoute.route}`;
        let entry = cachedHandlers.get(handler);
        if (!entry) {
          entry = { scope: id ?? `#${++scopeCounter}`, byRoute: new Map() };
          cachedHandlers.set(handler, entry);
        }
        let cachedHandler = entry.byRoute.get(key);
        if (!cachedHandler) {
          cachedHandler = defineCached(handler, {
            group: CACHE_GROUP,
            name: `${entry.scope}:${key}`,
            ...defaults,
            ...m.options,
          });
          entry.byRoute.set(key, cachedHandler);
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
