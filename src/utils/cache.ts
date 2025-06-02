import type { H3Event } from "../types/event.ts";

export interface CacheConditions {
  modifiedTime?: string | Date;
  maxAge?: number;
  etag?: string;
  cacheControls?: string[];
}

/**
 * Check request caching headers (`If-Modified-Since`) and add caching headers (Last-Modified, Cache-Control)
 * Note: `public` cache control will be added by default
 * @returns `true` when cache headers are matching. When `true` is returned, no response should be sent anymore
 */
export function handleCacheHeaders(
  event: H3Event,
  opts: CacheConditions,
): boolean {
  const cacheControls = ["public", ...(opts.cacheControls || [])];
  let cacheMatched = false;

  if (opts.maxAge !== undefined) {
    cacheControls.push(`max-age=${+opts.maxAge}`, `s-maxage=${+opts.maxAge}`);
  }

  if (opts.modifiedTime) {
    const modifiedTime = new Date(opts.modifiedTime);
    const ifModifiedSince = event.req.headers.get("if-modified-since");
    event.res.headers.set("last-modified", modifiedTime.toUTCString());
    if (ifModifiedSince && new Date(ifModifiedSince) >= modifiedTime) {
      cacheMatched = true;
    }
  }

  if (opts.etag) {
    event.res.headers.set("etag", opts.etag);
    const ifNonMatch = event.req.headers.get("if-none-match");
    if (ifNonMatch === opts.etag) {
      cacheMatched = true;
    }
  }

  event.res.headers.set("cache-control", cacheControls.join(", "));

  if (cacheMatched) {
    event.res.status = 304;
    return true;
  }

  return false;
}
