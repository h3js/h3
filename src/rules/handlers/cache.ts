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
  /**
   * Stable cache-key scope for this handler instance.
   *
   * By default every wrapped route handler gets a **fresh, process-unique**
   * scope, so two apps — or two matchers — can never resolve to the same cache
   * entry, not even when they share one handler instance (the module-scoped
   * `cache` export of `h3/rules/cache`) and register the same rule pattern for
   * the same route path. That isolation is what makes the default safe; its
   * cost is that keys are not stable across processes, so a **persistent**
   * storage backend (Redis, KV, …) is repopulated per process and never shared
   * between workers or across restarts.
   *
   * Set `id` to opt into stable keys: the scope becomes exactly this string, so
   * every instance configured with it shares entries. Only do that when the
   * instances provably serve the **same** application — the id is the only
   * thing separating one app's response bodies from another's.
   */
  id?: string;
}

const CACHE_GROUP = "h3/route-rules";

// Per-route-handler cache-key scope counter. Only ever appended to a key, never
// parsed; uniqueness within the process is the whole contract.
let scopeCounter = 0;

/**
 * Create the `cache` rule handler for a matcher instance from an injected
 * `defineCachedHandler`. Memoization is instance-scoped (a closure `WeakMap`
 * keyed by the dispatched route handler, then by method + rule + route pattern),
 * so each matcher wraps a given route exactly once across requests. Keying by
 * handler identity keeps same-path routes of different methods — and same-path
 * routes of different apps sharing one handler instance, such as the
 * module-scoped `cache` export of `h3/rules/cache` — from resolving to each
 * other's wrapper.
 *
 * The generated cache `name` carries a per-(instance, route handler) scope on
 * top of that, so the *storage* entries are isolated too: wrapper isolation
 * alone would still let two apps with the same rule pattern and route path read
 * and write one another's cached bodies. See {@link CacheRuleHandlerOptions.id}
 * for the stable-key opt-out. An explicit `name` in the rule options (or in
 * `defaults`) replaces the generated one and therefore opts out of both the
 * scope and the method separation.
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
