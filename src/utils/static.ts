import type { H3Event } from "../event.ts";
import { HTTPError } from "../error.ts";
import { withLeadingSlash, withoutTrailingSlash, resolveDotSegments } from "./internal/path.ts";
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

  const originalId = resolveDotSegments(
    decodeURI(withLeadingSlash(withoutTrailingSlash(event.url.pathname))),
  );

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

  if (meta.size !== undefined && meta.size > 0) {
    event.res.headers.set("accept-ranges", "bytes");
  }

  // Handle Range requests (RFC 9110 Section 14)
  const rangeHeader = event.req.headers.get("range");
  const ifRange = event.req.headers.get("if-range");
  const rangeValid =
    !ifRange ||
    (meta.etag && ifRange === meta.etag) ||
    (meta.mtime && new Date(ifRange).getTime() === new Date(meta.mtime).getTime());

  if (rangeHeader && rangeValid && meta.size !== undefined && meta.size > 0) {
    const range = parseRange(rangeHeader, meta.size);
    if (range === -1) {
      // Unsatisfiable range
      event.res.headers.set("content-range", `bytes */${meta.size}`);
      return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
    }
    if (range) {
      const { start, end } = range;
      const length = end - start + 1;
      event.res.headers.set("content-range", `bytes ${start}-${end}/${meta.size}`);
      event.res.headers.set("content-length", length + "");

      if (event.req.method === "HEAD") {
        return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
      }

      const contents = await options.getContents(id);
      const sliced = contents ? await sliceBody(contents, start, end) : null;
      return new HTTPResponse(sliced, { status: 206, statusText: "Partial Content" });
    }
  }

  if (meta.size !== undefined && meta.size > 0 && !event.res.headers.has("content-length")) {
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

/**
 * Parse a single byte Range header value.
 * Returns { start, end } for valid range, -1 for unsatisfiable, undefined for malformed/multi-range.
 */
function parseRange(header: string, size: number): { start: number; end: number } | -1 | undefined {
  if (!header.startsWith("bytes=")) {
    return undefined;
  }
  const rangeStr = header.slice(6);
  // Only support single range
  if (rangeStr.includes(",")) {
    return undefined;
  }
  const [startStr, endStr] = rangeStr.split("-");
  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffix = Number.parseInt(endStr, 10);
    if (Number.isNaN(suffix) || suffix <= 0) {
      return -1;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr ? Number.parseInt(endStr, 10) : size - 1;
    if (Number.isNaN(start) || start < 0 || start >= size) {
      return -1;
    }
    if (Number.isNaN(end) || end >= size) {
      end = size - 1;
    }
    if (start > end) {
      return -1;
    }
  }
  return { start, end };
}

async function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit> {
  if (body instanceof ArrayBuffer) {
    return body.slice(start, end + 1);
  }
  if (body instanceof Uint8Array || ArrayBuffer.isView(body)) {
    return (body.buffer as ArrayBuffer).slice(body.byteOffset + start, body.byteOffset + end + 1);
  }
  if (body instanceof Blob) {
    return body.slice(start, end + 1);
  }
  // For strings and other types, convert to bytes first
  if (typeof body === "string") {
    return (new TextEncoder().encode(body).buffer as ArrayBuffer).slice(start, end + 1);
  }
  // ReadableStream or other — read full and slice
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let chunk = await reader.read();
    while (!chunk.done) {
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
    const full = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      full.set(c, offset);
      offset += c.length;
    }
    return (full.buffer as ArrayBuffer).slice(start, end + 1);
  }
  return body;
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
