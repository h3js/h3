import type { H3Event } from "../event.ts";
import { isCacheMatch } from "./internal/cache.ts";
import {
  detachStagedHeaders,
  getStagedHeader,
  reattachStagedHeaders,
  withStagedHeaders,
} from "./internal/staged-headers.ts";

export interface CacheConditions {
  modifiedTime?: string | Date;
  maxAge?: number;
  etag?: string;
  cacheControls?: string[];
  /**
   * `If-None-Match` to evaluate instead of the request header. A cache layer
   * that narrows the request it forwards holds the only copy of the validator.
   */
  ifNoneMatch?: string;
  /** `If-Modified-Since` to evaluate instead of the request header. */
  ifModifiedSince?: string;
}

// Match a whole comma-separated Cache-Control directive (optionally with an
// `=value`), anchored to the start of an entry or a comma so we don't match a
// substring like `x-private` or a quoted value such as `no-cache="private"`.
// Entries may bundle multiple directives (e.g. "max-age=60, private"), which is
// why anchoring only to `^` would miss them.
const RE_PRIVATE = /(?:^|,)\s*(?:private|no-store)(?:\s*=|\s*,|\s*$)/i;
const RE_PUBLIC = /(?:^|,)\s*public(?:\s*=|\s*,|\s*$)/i;

/**
 * Check request caching headers (`If-None-Match`, `If-Modified-Since`) and add caching headers (Last-Modified, ETag, Cache-Control).
 *
 * Note: `public` is added by default, but never alongside a caller-supplied `private`/`no-store` directive, so passing `cacheControls: ["private"]` no longer produces a contradictory `public, private`.
 * @returns `true` when cache headers are matching. When `true` is returned, no response should be sent anymore
 */
export function handleCacheHeaders(event: H3Event, opts: CacheConditions): boolean {
  const cacheControls = [...(opts.cacheControls || [])];
  const joined = cacheControls.join(",");

  // A response is private when the caller opts into `private` or `no-store`;
  // shared-cache directives (`public`, `s-maxage`) must not be added for it.
  const isPrivate = RE_PRIVATE.test(joined);

  // Default to `public` for shared caches, but never alongside an explicit
  // visibility directive — that would produce contradictory pairs like
  // `public, private` for authenticated/personalized responses.
  if (!isPrivate && !RE_PUBLIC.test(joined)) {
    cacheControls.unshift("public");
  }

  if (opts.maxAge !== undefined) {
    cacheControls.push(`max-age=${+opts.maxAge}`);
    // `s-maxage` only applies to shared caches; omit it for private responses.
    if (!isPrivate) {
      cacheControls.push(`s-maxage=${+opts.maxAge}`);
    }
  }

  if (opts.etag) {
    event.res.headers.set("etag", opts.etag);
  }

  let lastModified: Date | undefined;
  if (opts.modifiedTime) {
    lastModified = new Date(opts.modifiedTime);
    lastModified.setMilliseconds(0);
    event.res.headers.set("last-modified", lastModified.toUTCString());
  }

  event.res.headers.set("cache-control", cacheControls.join(", "));

  if (
    isCacheMatch(event.req.headers, {
      etag: opts.etag,
      lastModified,
      ifNoneMatch: opts.ifNoneMatch,
      ifModifiedSince: opts.ifModifiedSince,
    })
  ) {
    event.res.status = 304;
    return true;
  }

  return false;
}

/**
 * Wrap a cached handler so headers staged on `event.res` before it runs (for example by global middleware) never enter its cache entry.
 *
 * A cache miss usually renders the handler result with `toResponse(value, event)`, which merges staged headers into the stored response, so later hits would replay one user's headers to everyone. The wrapper takes them off the event for the cached dispatch and merges them onto each successful response, hit or miss; error responses (4xx/5xx) don't receive them, as in h3. When the handler returns something other than a `Response`, they are put back on the event instead.
 *
 * A staged header wins over the same header set by the handler, so a miss looks the same as a hit.
 *
 * Headers that decide whether a response may be stored stay visible to the cache: a staged `Cache-Control` and every staged `Vary` name except `origin`. A response that middleware marked `private`/`no-store`, or that varies on a request header the cache isn't keyed on, is therefore not stored. A staged `private`/`no-store` `Cache-Control` is also sent to the client in place of the one the cached handler sets, so a CDN in front of the app doesn't store it either. A `Vary: Origin` is isolated, because the CORS headers it declares are staged per request as well.
 *
 * Properties of the wrapped handler (such as ocache's `invalidate`, `expire` and `resolveKeys`) are copied to the returned handler.
 *
 * @example
 * import { handleCacheHeaders, toResponse, withCacheIsolation } from "h3";
 * import { defineCachedHandler } from "ocache";
 *
 * const cached = withCacheIsolation(
 *   defineCachedHandler(() => "hello", {
 *     maxAge: 60,
 *     toResponse: (value, event) => toResponse(value, event),
 *     handleCacheHeaders: (event, conditions) => handleCacheHeaders(event, conditions),
 *   }),
 * );
 * app.get("/cached", cached);
 *
 * @param handler The cached event handler to wrap.
 */
export function withCacheIsolation<T extends (event: H3Event) => unknown>(handler: T): T {
  async function _handlerWithCacheIsolation(event: H3Event) {
    const cacheControl = getStagedHeader(event, "cache-control");
    const privateCacheControl =
      cacheControl !== null && RE_PRIVATE.test(cacheControl) ? cacheControl : undefined;
    const staged = detachStagedHeaders(event);
    let res: unknown;
    try {
      res = await handler(event);
    } catch (error) {
      if (staged) {
        reattachStagedHeaders(event, staged);
      }
      throw error;
    }
    if (privateCacheControl) {
      // The cached dispatch's `handleCacheHeaders` replaces it with `public`;
      // a shared cache in front of the app must still see it as private.
      event.res.headers.set("cache-control", privateCacheControl);
    }
    if (!staged) {
      return res;
    }
    if (res instanceof Response) {
      return withStagedHeaders(res, staged);
    }
    reattachStagedHeaders(event, staged);
    return res;
  }
  return Object.assign(_handlerWithCacheIsolation, handler) as unknown as T;
}
