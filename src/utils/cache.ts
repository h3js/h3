import type { H3Event } from "../event.ts";

export interface CacheConditions {
  modifiedTime?: string | Date;
  maxAge?: number;
  etag?: string;
  cacheControls?: string[];
}

/**
 * Check request caching headers (`If-None-Match`, `If-Modified-Since`) and add caching headers (Last-Modified, ETag, Cache-Control).
 *
 * Note: `public` is only added to `Cache-Control` when no explicit `cacheControls` are provided, so passing `cacheControls: ["private"]` no longer results in a contradictory `public, private`.
 * @returns `true` when cache headers are matching. When `true` is returned, no response should be sent anymore
 */
export function handleCacheHeaders(event: H3Event, opts: CacheConditions): boolean {
  // Only default to `public` when the user did not provide explicit cache controls.
  // Prepending `public` unconditionally would produce contradictory directives
  // like `public, private` for authenticated/personalized responses.
  const cacheControls = opts.cacheControls ? [...opts.cacheControls] : ["public"];

  if (opts.maxAge !== undefined) {
    cacheControls.push(`max-age=${+opts.maxAge}`, `s-maxage=${+opts.maxAge}`);
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

  // RFC 9110 §13.1.3: a recipient MUST ignore `If-Modified-Since` when the
  // request contains an `If-None-Match` header field. `If-None-Match` takes
  // precedence; `If-Modified-Since` is only evaluated when it is absent.
  let cacheMatched = false;
  const ifNoneMatch = event.req.headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    cacheMatched = !!opts.etag && matchETag(ifNoneMatch, opts.etag);
  } else if (lastModified) {
    const ifModifiedSince = event.req.headers.get("if-modified-since");
    cacheMatched = !!ifModifiedSince && new Date(ifModifiedSince) >= lastModified;
  }

  if (cacheMatched) {
    event.res.status = 304;
    return true;
  }

  return false;
}

/**
 * Evaluate an `If-None-Match` field-value against an ETag using the weak
 * comparison function (RFC 9110 §8.8.3.2 and §13.1.2).
 *
 * - `*` matches any current representation.
 * - The field-value is a comma-separated list of entity-tags.
 * - Weak comparison ignores the `W/` weakness indicator on either side.
 */
function matchETag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") {
    return true;
  }
  const target = opaqueTag(etag);
  return ifNoneMatch.split(",").some((tag) => opaqueTag(tag.trim()) === target);
}

function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}
