import type { H3Event } from "../event.ts";
import { HTTPError } from "../error.ts";
import { decodePreservingSeparators, withoutTrailingSlash } from "./internal/path.ts";
import { isCanonicalPath } from "./path.ts";
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
 * A **non-canonical pathname is not served** (404, or falls through when
 * `fallthrough` is set): more than one leading separator (`//private/x`,
 * `/\\private/x`) or a dot segment that survived URL canonicalization, which
 * means one spelled with `%25`-nested escapes (`/pub/%252e%252e/private/x`).
 * Both dispatch to a catch-all route while missing a narrower
 * `use("/private/**")` guard, and the only `id` `serveStatic` could build from
 * them resolves back into the guarded path. Assets are reachable under their
 * canonical spelling — the one routing and `use()` guards match on — only.
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

  // The id has to keep the segment structure dispatch matched on, so the one
  // thing it must never do is *rewrite* the pathname. `isCanonicalPath` rejects
  // exactly the inputs `resolveDotSegments` would rewrite rather than pass
  // through — a leading `[/\\]` run, a `\`, and a dot segment at any
  // `%25`-nesting depth — and each rewrite re-spells the request into a path the
  // router never saw:
  //   - `//private/x` misses a `use("/private/**")` guard (a literal
  //     `startsWith`, matching rou3) while a catch-all static route still
  //     matches; clamping the run to a single `/` for the lookup then serves the
  //     guarded asset unauthenticated.
  //   - `/pub/%252e%252e/private/x` is four opaque segments to `~findRoute` and
  //     to that same guard. Canonicalization decodes `%2e` (so the URL parser
  //     resolves `/pub/%2e%2e/private/x` before anything matches on it) but never
  //     `%25`, so a `%25`-nested spelling is *meant* to stay opaque; resolving
  //     those dots here walks the id back to the guarded `/private/x`.
  // Same class of hole as the `%5c` peel below, so same answer: refuse, rather
  // than serve a second, cache- and WAF-invisible spelling. Assets stay reachable
  // under their canonical spelling — the one the router sees — only.
  if (!isCanonicalPath(event.url.pathname)) {
    if (options.fallthrough) {
      return;
    }
    throw new HTTPError({ status: 404 });
  }

  // The path is canonical per the check above, so there is no traversal left to
  // resolve — the pathname *is* its own resolved form. All that remains is to
  // peel one `%25` level for the on-disk lookup (guarded: malformed `%` falls
  // back to the still-encoded pathname).
  //
  // The peel must never turn an encoded separator into a real one. `decodeURI`
  // holds back `%2f` (RFC 3986 reserved) but *not* `%5c`, which it decodes to
  // `\` — and `/private%5cx` is one opaque segment to `~findRoute` and to a
  // `use("/private/**")` guard, so a backend resolving `\` would read it as the
  // guarded `/private/x`. `decodePreservingSeparators` keeps both encoded, so the
  // id keeps the segment structure routing matched on.
  //
  // `nested: false` because this is a single decode: one `%25` level off `%252f`
  // leaves a literal `%2f`, not a separator, so filenames containing `%2f` stay
  // addressable. `decodeURI` (not `decodeURIComponent`) keeps `%23`/`%3f`
  // encoded, so a URL-composing backend cannot grow a truncating `#`/`?`.
  //
  // Re-checked rather than re-resolved: with no separator introduced there is no
  // new segment boundary, so a dot segment the peel reveals (one `%25` level off
  // `%252e`) can only be one the pathname already carried at a deeper nesting —
  // refused above. Resolving one here is precisely what would re-spell the id.
  const resolvedId = withoutTrailingSlash(event.url.pathname);
  let originalId = resolvedId;
  if (resolvedId.includes("%")) {
    try {
      const decodedId = decodePreservingSeparators(resolvedId, {
        decode: decodeURI,
        nested: false,
      });
      if (isCanonicalPath(decodedId)) {
        originalId = withoutTrailingSlash(decodedId);
      }
    } catch {
      // Malformed escape (e.g. a trailing `%`): keep the still-encoded
      // `resolvedId` already assigned to `originalId` above.
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
