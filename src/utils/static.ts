import type { H3Event } from "../event.ts";
import { HTTPError } from "../error.ts";
import { decodePreservingSeparators, withoutTrailingSlash } from "./internal/path.ts";
import { resolveDotSegments } from "./path.ts";
import { getType, getExtension } from "./internal/mime.ts";
import { isCacheMatch } from "./internal/cache.ts";
import { HTTPResponse } from "../response.ts";

export interface StaticAssetMeta {
  type?: string;
  etag?: string;
  mtime?: number | string | Date;
  size?: number;
  encoding?: string;
}

export interface ServeStaticOptions {
  /**
   * This function should resolve asset meta.
   *
   * **Security:** The `id` keeps encoded separators (`%2f`, `%5c`)
   * percent-encoded. Decoding them here re-introduces separators and defeats
   * the traversal normalization done by `serveStatic`. See {@link serveStatic}.
   */
  getMeta: (id: string) => StaticAssetMeta | undefined | Promise<StaticAssetMeta | undefined>;

  /**
   * This function should resolve asset content.
   *
   * **Security:** As with `getMeta`, the `id` must not be decoded before
   * resolving the asset. See {@link serveStatic}.
   */
  getContents: (id: string) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;

  /**
   * Headers to set on the response
   */
  headers?: HeadersInit;

  /**
   * Map of supported encodings (compressions) and their file extensions.
   *
   * Each extension will be appended to the asset path to find the compressed version of the asset.
   *
   * @example { gzip: ".gz", br: ".br" }
   */
  encodings?: Record<string, string>;

  /**
   * Default index file to serve when the path is a directory
   *
   * @default ["/index.html"]
   */
  indexNames?: string[];

  /**
   * When set to true, the function will not throw 404 error when the asset meta is not found or meta validation failed
   */
  fallthrough?: boolean;

  /**
   * Custom MIME type resolver function
   * @param ext - File extension including dot (e.g., ".css", ".js")
   */
  getType?: (ext: string) => string | undefined;
}

/**
 * Dynamically serve static assets based on the request path.
 *
 * **Security — path traversal:** `serveStatic` resolves `.`/`..` segments but
 * deliberately keeps encoded separators (`%2f`, `%5c`) percent-encoded in the
 * `id` it passes to `getMeta`/`getContents`, exactly as `event.url.pathname`
 * does. The `id` therefore has the same segment structure the router and
 * pathname-scoped `use()` guards matched on: `/private%5cx` stays one opaque
 * segment and cannot be served as `/private/x` past a `use("/private/**")`
 * guard. Resolve the `id` against your asset root as an opaque string — a
 * backend that decodes it re-introduces separators and re-opens the hole.
 *
 * A pathname starting with more than one separator (`//private/x`,
 * `/\\private/x`) is **not served** (404, or falls through when `fallthrough`
 * is set): it dispatches to a catch-all route but misses a narrower
 * `use("/private/**")` guard, and the only `id` `serveStatic` could build from
 * it collapses that leading run, re-spelling it into a path the guard would
 * have caught. Assets are reachable under their canonical spelling only.
 *
 * Everything else is decoded once for the on-disk lookup, so a file's real name
 * reaches the backend: `/50%25.png` → `/50%.png`, `/a%20b` → `/a b`, and one
 * `%25` level is peeled off a nested separator (`/a%252fb` → `/a%2fb`, still a
 * literal `%2f`, never a boundary). RFC 3986's reserved set stays encoded, so an
 * `id` can never grow a `?` or `#` that would truncate it in a URL.
 *
 * Two things `serveStatic` cannot enforce for filesystem-backed assets:
 * **case-insensitive filesystems** (macOS, Windows) need both sides of any
 * allow/deny check case-folded (otherwise `/SECRET.env` slips past a check for
 * `/secret.env`), and **symlinks** need the resolved path re-asserted against
 * the asset root after following links (e.g. `realpath(target)`).
 */
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined> {
  if (options.headers) {
    const entries = Array.isArray(options.headers)
      ? options.headers
      : typeof options.headers.entries === "function"
        ? options.headers.entries()
        : Object.entries(options.headers);
    for (const [key, value] of entries) {
      event.res.headers.set(key, value);
    }
  }

  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    if (options.fallthrough) {
      return;
    }
    event.res.headers.set("allow", "GET, HEAD");
    throw new HTTPError({ status: 405 });
  }

  // A leading `[/\\]` run is the one thing `resolveDotSegments` rewrites rather
  // than resolves: it clamps the run to a single `/` (a protocol-relative id must
  // never reach a URL-composing backend). But dispatch already happened against
  // the un-collapsed path, so collapsing here would re-spell the id into a path
  // the router never matched: `//private/x` misses a `use("/private/**")` guard
  // while a catch-all static route still matches, serving the guarded asset
  // unauthenticated. Same class of hole as the `%5c` peel below, so same answer:
  // refuse, rather than serve a second, cache- and WAF-invisible spelling.
  const secondChar = event.url.pathname.charCodeAt(1);
  if (secondChar === 47 /* / */ || secondChar === 92 /* \ */) {
    if (options.fallthrough) {
      return;
    }
    throw new HTTPError({ status: 404 });
  }

  // Resolve traversal first, then peel one `%25` level for the on-disk lookup
  // (guarded: malformed `%` falls back to the safe traversal-resolved value).
  //
  // The peel must never turn an encoded separator into a real one. `decodeURI`
  // holds back `%2f` (RFC 3986 reserved) but *not* `%5c`, which it decodes to
  // `\`, and `resolveDotSegments` then normalizes that to `/`: `/private%5cx` is
  // one opaque segment to `~findRoute` and to a `use("/private/**")` guard, but
  // would reach the backend as `/private/x`. `decodePreservingSeparators` keeps
  // both encoded, so the id keeps the segment structure routing matched on.
  //
  // `nested: false` because this is a single decode: one `%25` level off `%252f`
  // leaves a literal `%2f`, not a separator, so filenames containing `%2f` stay
  // addressable. `decodeURI` (not `decodeURIComponent`) keeps `%23`/`%3f`
  // encoded, so a URL-composing backend cannot grow a truncating `#`/`?`.
  //
  // The second `resolveDotSegments` still runs: the peel can reveal a dot segment
  // (one `%25` level off `%252e`), which must not reach the backend as a bare `..`.
  const resolvedId = withoutTrailingSlash(resolveDotSegments(event.url.pathname));
  let originalId = resolvedId;
  if (resolvedId.includes("%")) {
    try {
      originalId = withoutTrailingSlash(
        resolveDotSegments(
          decodePreservingSeparators(resolvedId, { decode: decodeURI, nested: false }),
        ),
      );
    } catch {
      // Malformed escape (e.g. trailing `%`): keep the traversal-resolved,
      // still-encoded `resolvedId` already assigned to `originalId` above.
    }
  }

  const acceptEncodings = parseAcceptEncoding(
    event.req.headers.get("accept-encoding") || "",
    options.encodings,
  );

  if (acceptEncodings.length > 1) {
    event.res.headers.set("vary", "accept-encoding");
  }

  let id = originalId;
  let meta: StaticAssetMeta | undefined;

  const _ids = idSearchPaths(originalId, acceptEncodings, options.indexNames || ["/index.html"]);

  for (const _id of _ids) {
    const _meta = await options.getMeta(_id);
    if (_meta) {
      meta = _meta;
      id = _id;
      break;
    }
  }

  if (!meta) {
    if (options.fallthrough) {
      return;
    }
    throw new HTTPError({ statusCode: 404 });
  }

  let mtimeDate: Date | undefined;
  if (meta.mtime) {
    mtimeDate = new Date(meta.mtime);
    // Truncate to whole seconds to match HTTP date precision, so a client
    // echoing our `last-modified` in `if-modified-since` still matches.
    mtimeDate.setMilliseconds(0);

    if (!event.res.headers.get("last-modified")) {
      event.res.headers.set("last-modified", mtimeDate.toUTCString());
    }
  }

  if (meta.etag && !event.res.headers.has("etag")) {
    event.res.headers.set("etag", meta.etag);
  }

  if (isCacheMatch(event.req.headers, { etag: meta.etag, lastModified: mtimeDate })) {
    return new HTTPResponse(null, {
      status: 304,
      statusText: "Not Modified",
    });
  }

  if (!event.res.headers.get("content-type")) {
    if (meta.type) {
      event.res.headers.set("content-type", meta.type);
    } else {
      const ext = getExtension(id);
      const type = ext ? (options.getType?.(ext) ?? getType(ext)) : undefined;
      if (type) {
        event.res.headers.set("content-type", type);
      }
    }
  }

  if (meta.encoding && !event.res.headers.get("content-encoding")) {
    event.res.headers.set("content-encoding", meta.encoding);
  }

  if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
    event.res.headers.set("content-length", meta.size + "");
  }

  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 200 });
  }

  const contents = await options.getContents(id);
  return new HTTPResponse(contents || null, { status: 200 });
}

// --- Internal Utils ---

function parseAcceptEncoding(header?: string, encodingMap?: Record<string, string>): string[] {
  if (!encodingMap || !header) {
    return [];
  }
  return String(header || "")
    .split(",")
    .map((e) => encodingMap[e.trim()])
    .filter(Boolean);
}

function idSearchPaths(id: string, encodings: string[], indexNames: string[]) {
  const ids = [];

  for (const suffix of ["", ...indexNames]) {
    for (const encoding of [...encodings, ""]) {
      ids.push(`${id}${suffix}${encoding}`);
    }
  }

  return ids;
}
