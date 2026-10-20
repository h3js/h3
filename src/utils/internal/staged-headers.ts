import { kEventRes, kEventResHeaders } from "../../event.ts";
import type { H3Event } from "../../event.ts";

/** Read a header staged on `event.res` without creating the response. */
export function getStagedHeader(event: H3Event, name: string): string | null {
  return (event as any)[kEventRes]?.[kEventResHeaders]?.get(name) ?? null;
}

/**
 * Take the headers earlier middleware staged on `event.res` out of the event,
 * so the `toResponse` of a cache miss cannot merge them into the shared entry
 * (h3js/h3#1605). They are per-request and go back onto every response, hit
 * or miss, through {@link withStagedHeaders}.
 *
 * `Cache-Control` and `Vary` names other than `origin` stay staged: they
 * decide whether the response may be stored at all, and the cache only sees
 * them in the entry. A middleware staging `private` for an authenticated
 * request must keep that response out of the shared cache, not just off the
 * wire.
 *
 * They stay out of the event rather than being restored onto it: an `swr`
 * revalidation keeps running the handler on this event after the stale
 * response is returned. Error headers are left alone, since an error status
 * is never stored.
 */
export function detachStagedHeaders(event: H3Event): Headers | undefined {
  const res = (event as any)[kEventRes];
  const staged: Headers | undefined = res?.[kEventResHeaders];
  if (!staged) {
    return;
  }
  const kept = new Headers();
  const cacheControl = staged.get("cache-control");
  if (cacheControl !== null) {
    kept.set("cache-control", cacheControl);
    staged.delete("cache-control");
  }
  const vary = staged.get("vary");
  if (vary !== null) {
    // Only `origin` is detached: it declares the per-request CORS headers that
    // are detached with it. Any other name may select what the handler renders
    // (e.g. middleware reading `accept-language` into the context), so the
    // cache must see it and refuse to store an entry it isn't keyed on.
    const names = vary
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const rest = names.filter((name) => name.toLowerCase() !== "origin");
    if (rest.length > 0) {
      kept.set("vary", rest.join(", "));
    }
    if (rest.length === names.length) {
      staged.delete("vary");
    } else {
      staged.set("vary", "origin");
    }
  }
  res[kEventResHeaders] = kept.keys().next().done ? undefined : kept;
  return staged.keys().next().done ? undefined : staged;
}

/**
 * Apply detached staged headers to the response the cache returned. Headers
 * staged during the dispatch (`handleCacheHeaders`, ...) are still on
 * `event.res` and are merged over these by h3 as usual. Like h3, success
 * headers never reach an error response.
 */
export function withStagedHeaders(res: Response, staged: Headers): Response {
  if (res.status >= 400) {
    return res;
  }
  const headers = new Headers(res.headers);
  mergeStagedHeaders(headers, staged);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Put detached headers back under whatever was staged since, for h3 to render. */
export function reattachStagedHeaders(event: H3Event, staged: Headers): void {
  const res = event.res as any;
  const after: Headers | undefined = res[kEventResHeaders];
  if (after) {
    mergeStagedHeaders(staged, after);
  }
  res[kEventResHeaders] = staged;
}

/**
 * Merge `source` into `target` the way h3 merges staged headers into a
 * response, except that `Vary` lists are joined: the entry's own `Vary`
 * declares its cache key and must not be replaced by a staged one.
 */
function mergeStagedHeaders(target: Headers, source: Headers): void {
  for (const [name, value] of source) {
    if (name === "set-cookie") {
      target.append(name, value);
    } else if (name === "vary" && target.has("vary")) {
      appendVary(target, value);
    } else {
      target.set(name, value);
    }
  }
}

function appendVary(headers: Headers, value: string): void {
  const names = headers
    .get("vary")!
    .split(",")
    .map((name) => name.trim());
  const known = new Set(names.map((name) => name.toLowerCase()));
  for (const name of value.split(",")) {
    const trimmed = name.trim();
    if (trimmed && !known.has(trimmed.toLowerCase())) {
      known.add(trimmed.toLowerCase());
      names.push(trimmed);
    }
  }
  headers.set("vary", names.filter(Boolean).join(", "));
}
