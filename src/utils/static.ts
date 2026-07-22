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

  // Range requests need a known, whole-asset size to validate/compute against.
  let range: { start: number; end: number } | undefined;
  const size = meta.size !== undefined && meta.size > 0 ? meta.size : undefined;
  if (size !== undefined) {
    event.res.headers.set("accept-ranges", "bytes");
    const rangeHeader = event.req.headers.get("range");
    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, size);
      if (parsed === "unsatisfiable") {
        return new HTTPResponse(null, {
          status: 416,
          headers: { "content-range": `bytes */${size}`, "content-length": "0" },
        });
      }
      range = parsed;
    }
  }

  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    event.res.headers.set("content-length", range.end - range.start + 1 + "");
  } else if (size !== undefined && !event.res.headers.get("content-length")) {
    event.res.headers.set("content-length", size + "");
  }

  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: range ? 206 : 200 });
  }

  const contents = await options.getContents(id);
  if (range) {
    const sliced = sliceBody(contents, range.start, range.end);
    if (sliced !== undefined) {
      return new HTTPResponse(sliced, { status: 206 });
    }
    // Content isn't sliceable (e.g. a stream): fall back to a full response.
    event.res.headers.delete("content-range");
    event.res.headers.set("content-length", size + "");
  }
  return new HTTPResponse(contents || null, { status: 200 });
}

// --- Internal Utils ---

/**
 * Parse a `range` request header against a known resource size.
 *
 * Only a single `bytes=<start>-<end>` range is supported (per the spec, a
 * multi-range request is one that a server may satisfy by ignoring the header
 * and returning the full entity instead) — malformed or multi-range headers
 * return `undefined` so the caller serves the full response. A range that is
 * out of bounds (start beyond the resource size, or an empty suffix range)
 * returns `"unsatisfiable"` so the caller can respond with `416`.
 */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d+)?-(\d+)?$/.exec(header.trim());
  if (!match) {
    return undefined; // Malformed or multi-range: ignore, serve full response
  }
  const [, startStr, endStr] = match;
  if (startStr === undefined && endStr === undefined) {
    return undefined;
  }

  let start: number;
  let end: number;
  if (startStr === undefined) {
    // Suffix range: last `endStr` bytes
    const suffixLength = Number(endStr);
    if (suffixLength === 0) {
      return "unsatisfiable";
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === undefined ? size - 1 : Number(endStr);
  }

  if (start > end || start >= size) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Slice a `BodyInit` to the given inclusive byte range. Returns `undefined`
 * when the content type can't be sliced without fully buffering it (e.g. a
 * `ReadableStream`), letting the caller fall back to a full response.
 */
function sliceBody(
  contents: BodyInit | null | undefined,
  start: number,
  end: number,
): BodyInit | undefined {
  if (typeof contents === "string") {
    return new TextEncoder().encode(contents).slice(start, end + 1);
  }
  if (contents instanceof Blob) {
    return contents.slice(start, end + 1);
  }
  if (contents instanceof ArrayBuffer) {
    return contents.slice(start, end + 1);
  }
  if (contents instanceof Uint8Array) {
    return contents.slice(start, end + 1);
  }
  return undefined;
}

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
