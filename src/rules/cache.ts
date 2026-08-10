// `h3/rules/cache` — the ocache-backed `cache` rule handler. This is the only
// rules module that imports ocache (an **optional** peer dependency):
// rule sets using `cache`/`swr` register a handler from here, everything else
// never pulls ocache into the bundle. Consumers with their own caching
// conventions skip this module entirely and inject a `defineCachedHandler`
// into the core `createCacheRuleHandler` (`h3/rules`) instead.

import { defineHandler } from "../handler.ts";
import { HTTPResponse, toResponse } from "../response.ts";
import { handleCacheHeaders } from "../utils/cache.ts";
import type { H3Event } from "../event.ts";
import { defineCachedHandler as ocacheDefineCachedHandler, setStorage } from "ocache";
import type { CachedEventHandlerOptions, StorageInterface } from "ocache";
import { createCacheRuleHandler } from "./handlers/cache.ts";
import type { RuleHandler } from "./types.ts";

/**
 * Options for the ocache-backed {@link createOcacheRuleHandler}. All fields
 * are optional; the default uses ocache's in-memory storage out of the box.
 */
export interface OcacheRuleHandlerOptions {
  /** ocache storage implementation (minimal `get`/`set`). Applied via `setStorage`. */
  storage?: StorageInterface;
  /**
   * Default ocache options merged into every cache rule (rule options win).
   * Fully typed against ocache — implementation hooks (`getKey`, `shouldCache`,
   * `getMaxAge`, …) that the declarative rule schema excludes go here.
   */
  defaults?: CachedEventHandlerOptions;
}

// Per-request CORS response headers, reflected from the request `Origin` by
// the `cors` rule (h3's `appendCorsHeaders`, order -3 — it runs before the
// cache handler, so they end up on the response the resolver serializes).
// Baking them into a shared cache entry serves one requester's
// `access-control-allow-origin` to every other origin — violating the
// response's own `vary: origin` (RFC 9111 §4.1) and, with credentials,
// enabling a cross-origin leak. `vary` itself stays in the entry: it is
// correct metadata for the final response either way.
const VOLATILE_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
] as const;

/**
 * Move volatile CORS headers off the response that is about to be serialized
 * into the shared cache, back onto the live `event.res.headers`.
 *
 * The move (not just a strip) matters: h3's inner `toResponse` above already
 * *consumed* `event.res` (cors's appended headers included) into this
 * response, so the current — cache-miss — request would otherwise lose its
 * own correct CORS headers. Re-set on a fresh `event.res`, h3's outer
 * `prepareResponse` merges them into the 2xx response at send time. Cache
 * *hits* need nothing here: the `cors` rule runs on every request and appends
 * fresh, request-correct headers that `prepareResponse` merges the same way.
 */
function moveVolatileCorsHeaders(res: Response, event: H3Event): Response {
  // Only GET/HEAD responses can ever be serialized into the cache — leave the
  // (never-cached) method-bypass path untouched.
  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    return res;
  }
  const moved: [name: string, value: string][] = [];
  for (const name of VOLATILE_CORS_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) {
      moved.push([name, value]);
    }
  }
  if (moved.length === 0) {
    return res;
  }
  try {
    for (const [name] of moved) {
      res.headers.delete(name);
    }
  } catch {
    // Immutable headers (e.g. a handler-returned `fetch` Response) — rebuild.
    res = new Response(res.body, res);
    for (const [name] of moved) {
      res.headers.delete(name);
    }
  }
  for (const [name, value] of moved) {
    event.res.headers.set(name, value);
  }
  return res;
}

/**
 * Create an ocache-backed `cache` rule handler: ocache wired with h3's
 * `toResponse` / `handleCacheHeaders` so h3 handler return values (objects,
 * streams, …) serialize with full fidelity. No srvx / unstorage dependency —
 * global `Response` and ocache's in-memory storage by default.
 *
 * Memoization of wrapped handlers is instance-scoped (see the core
 * `createCacheRuleHandler` in `h3/rules`) — create one handler per matcher.
 *
 * Note: ocache storage is process-global — `storage` mutates it via
 * `setStorage`, affecting every ocache consumer in the process.
 */
export function createOcacheRuleHandler(opts?: OcacheRuleHandlerOptions): RuleHandler<"cache"> {
  if (opts?.storage) {
    setStorage(opts.storage);
  }
  return createCacheRuleHandler({
    defineCachedHandler: (handler, cachedOpts) => {
      const ocacheHandler = ocacheDefineCachedHandler(handler, {
        toResponse: async (value, event) =>
          moveVolatileCorsHeaders(await toResponse(value, event as H3Event), event as H3Event),
        handleCacheHeaders: (event, conditions) => handleCacheHeaders(event as H3Event, conditions),
        ...cachedOpts,
      });
      return defineHandler(async (event) => {
        const res = await ocacheHandler(event);
        // ocache's conditional-revalidation path builds a bare 304 `Response`,
        // and h3's `prepareResponse` merges `event.res.headers` only into 2xx
        // `Response` instances — the conditional headers set by
        // `handleCacheHeaders` (etag / cache-control / last-modified) and by
        // post-response `headers` rules would never reach the client, but a
        // 304 must carry what the 200 would (RFC 9110 §15.4.5). Returning
        // h3's `HTTPResponse` instead defers response construction to
        // `prepareResponse`, which merges the final `event.res.headers` over
        // the 304's own (`x-cache` / `vary`) for any status.
        if (res instanceof Response && res.status === 304) {
          return new HTTPResponse(null, { status: 304, headers: res.headers });
        }
        return res;
      });
    },
    defaults: opts?.defaults,
  });
}

/**
 * Shared default ocache-backed `cache` rule handler — the named export
 * compiled matchers import (`import { cache } from "h3/rules/cache"`, the
 * `DEFAULT_RUNTIME_RULES` source for `cache`), so its memoization is
 * module-scoped. Runtime matchers register it explicitly
 * (`handlers: { cache }`); for custom wiring point `runtimeRules`
 * (`{ cache: "#your/cache" }`) / `handlers` at your own instance instead.
 */
export const cache: RuleHandler<"cache"> = /* @__PURE__ */ createOcacheRuleHandler();
