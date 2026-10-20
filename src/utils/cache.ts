import type { H3Event } from "../event.ts";
import type {
  EventHandler,
  EventHandlerRequest,
  HTTPHandler,
  ResolvedRequest,
} from "../types/handler.ts";
import { toEventHandler } from "../handler.ts";
import { isCacheMatch } from "./internal/cache.ts";
import {
  detachStagedHeaders,
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
 * A cache miss usually renders the handler result with `toResponse(value, event)`, which merges staged headers into the stored response, so later hits would replay one user's headers to everyone. The wrapper takes them off the event for the cached dispatch and merges them onto every response it returns, hit or miss. Staged `Cache-Control` and a wildcard `Vary` stay visible to the cache, so a response middleware marked `private` or `no-store` is still not stored.
 *
 * @example
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
 * @param input The cached event handler to wrap.
 */
export function withCacheIsolation<_RequestT extends EventHandlerRequest = EventHandlerRequest>(
  input: HTTPHandler<_RequestT>,
): EventHandler<ResolvedRequest<_RequestT>> {
  const handler = toEventHandler(input);
  if (!handler) {
    throw new Error("Invalid handler", { cause: input });
  }

  return async function _handlerWithCacheIsolation(event) {
    const staged = detachStagedHeaders(event);
    if (!staged) {
      return handler(event);
    }
    let res: unknown;
    try {
      res = await handler(event);
    } catch (error) {
      reattachStagedHeaders(event, staged);
      throw error;
    }
    if (res instanceof Response) {
      return withStagedHeaders(res, staged);
    }
    reattachStagedHeaders(event, staged);
    return res;
  };
}
