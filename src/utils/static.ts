import type { H3Event } from "../event.ts";
import { HTTPError } from "../error.ts";
import { withoutTrailingSlash } from "./internal/path.ts";
import { resolveDotSegments } from "./path.ts";
import { getType, getExtension } from "./internal/mime.ts";
import { HTTPResponse } from "../response.ts";

export interface StaticAssetMeta {
  type?: string;
  etag?: string;
  mtime?: number | string | Date;
  path?: string;
  size?: number;
  encoding?: string;
}

export interface ServeStaticOptions {
  /**
   * This function should resolve asset meta
   */
  getMeta: (id: string) => StaticAssetMeta | undefined | Promise<StaticAssetMeta | undefined>;

  /**
   * This function should resolve asset content
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

  // Resolve `.`/`..` traversal FIRST, then decode, so the on-disk id matches
  // what `sirv`/`serve-static` serve (a filesystem-backed `getContents` no
  // longer needs self-decoding logic — e.g. `/50%25.png` finds `50%.png`).
  //
  // `event.url.pathname` is already decoded once by the event layer
  // (`decodePathname`, a single `decodeURI` that preserves `%25`), and
  // `resolveDotSegments` neutralizes every traversal escape (literal `../`,
  // `..\`, and `%2e`-encoded dot segments at any `%25`-nesting depth). Only
  // then do we `decodeURI` to peel one `%25` level (`%25` → `%`) for the
  // lookup. This never reintroduces a separator: `decodeURI` preserves `%2f`
  // (reserved), and a single-encoded `%5c` can't reach here — the event layer
  // already decoded it to `\` and `resolveDotSegments` normalized that away, so
  // only a double-encoded `%255c` survives and `decodeURI` collapses it to a
  // literal `%5c`, not a raw `\`.
  //
  // The final decode is guarded: with `allowMalformedURL`, a raw malformed `%`
  // (e.g. `/foo%`, `/%ZZ`) reaches here and `decodeURI` throws — fall back to
  // the traversal-resolved (still-safe) value so `fallthrough`/404 handling is
  // reached instead of a 500.
  const resolvedId = resolveDotSegments(withoutTrailingSlash(event.url.pathname));
  let originalId: string;
  try {
    originalId = decodeURI(resolvedId);
  } catch {
    originalId = resolvedId;
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

  if (meta.mtime) {
    const mtimeDate = new Date(meta.mtime);
    // HTTP dates have whole-second precision, but `mtime` may carry sub-second
    // milliseconds. The `last-modified` header is emitted truncated to seconds,
    // so the comparison must also ignore milliseconds — otherwise a client that
    // echoes our own `last-modified` value in `if-modified-since` never matches.
    mtimeDate.setMilliseconds(0);

    const ifModifiedSinceH = event.req.headers.get("if-modified-since");
    if (ifModifiedSinceH && new Date(ifModifiedSinceH) >= mtimeDate) {
      return new HTTPResponse(null, {
        status: 304,
        statusText: "Not Modified",
      });
    }

    if (!event.res.headers.get("last-modified")) {
      event.res.headers.set("last-modified", mtimeDate.toUTCString());
    }
  }

  if (meta.etag && !event.res.headers.has("etag")) {
    event.res.headers.set("etag", meta.etag);
  }

  const ifNotMatch = meta.etag && event.req.headers.get("if-none-match") === meta.etag;
  if (ifNotMatch) {
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
