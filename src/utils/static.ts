import type { H3Event } from "../event.ts";
import { HTTPError } from "../error.ts";
import { withoutTrailingSlash } from "./internal/path.ts";
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
   * **Security:** The `id` keeps encoded separators percent-encoded: `%2f`
   * (encoded `/`) always survives, and a double-encoded backslash arrives as a
   * literal `%5c` (a single-encoded `%5c` is decoded to `\` and normalized away
   * by `serveStatic`). Path traversal safety depends on this backend **not**
   * decoding them — a decode would re-introduce separators and defeat the
   * traversal normalization done by `serveStatic`. See {@link serveStatic}.
   */
  getMeta: (id: string) => StaticAssetMeta | undefined | Promise<StaticAssetMeta | undefined>;

  /**
   * This function should resolve asset content.
   *
   * **Security:** As with `getMeta`, the `id` keeps encoded separators (`%2f`,
   * and a double-encoded `%5c`) percent-encoded and this backend must not decode
   * them before resolving the asset. See {@link serveStatic}.
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
 * **Security — path traversal:** `serveStatic` resolves `.`/`..` segments and
 * normalizes the request path, but deliberately keeps encoded separators
 * **percent-encoded** in the `id` it passes to `getMeta`/`getContents`: `%2f`
 * (encoded `/`) always survives, and a double-encoded backslash arrives as a
 * literal `%5c` (a single-encoded `%5c` is decoded to `\` and normalized away).
 * Traversal safety therefore depends on those backends **not** decoding the `id`:
 * a backend that percent-decodes it (e.g. an extra `decodeURIComponent`, or a
 * lookup layer that decodes) re-introduces separators and **re-opens the
 * traversal hole**. Resolve the `id` against your asset root as an opaque string.
 *
 * When implementing custom `getMeta`/`getContents` over a real filesystem, the
 * integrator is also responsible for two things `serveStatic` cannot enforce.
 * **Case-insensitive filesystems** (macOS, Windows): case-fold both sides of any
 * allow/deny checks — otherwise `/SECRET.env` can slip past a check written for
 * `/secret.env`. **Symlink containment:** re-assert that the resolved path stays
 * within the asset root after following links (e.g. compare `realpath(target)`
 * against the root), since a symlink can point outside it.
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

  // Resolve traversal first, then peel one `%25` level for the on-disk lookup
  // (guarded: malformed `%` falls back to the safe traversal-resolved value).
  const resolvedId = withoutTrailingSlash(resolveDotSegments(event.url.pathname));
  let originalId = resolvedId;
  if (resolvedId.includes("%")) {
    try {
      originalId = decodeURI(resolvedId);
    } catch {
      originalId = resolvedId;
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
