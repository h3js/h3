import { HTTPError } from "../error.ts";
import { defineHandler } from "../handler.ts";
import { serializeAcceptQuery, baseMediaType, mediaTypeMatches } from "./internal/media-type.ts";
import { resolveGetQuery, setQueryContentLocation } from "./internal/query-get.ts";

import type { H3Event, HTTPEvent } from "../event.ts";
import type { EventHandlerObject, EventHandlerWithFetch } from "../types/handler.ts";

/**
 * Advertise the query formats a resource accepts by setting the `Accept-Query`
 * response header (RFC 10008, HTTP `QUERY` method).
 *
 * The media types are serialized as a
 * [Structured Fields](https://www.rfc-editor.org/rfc/rfc8941) List: the base
 * media type becomes a token and any `;name=value` parameters are emitted with
 * their values as quoted strings.
 *
 * @example
 * app.query("/search", (event) => {
 *   appendAcceptQuery(event, ["application/sql;charset=UTF-8", "application/jsonpath"]);
 *   // Accept-Query: application/sql;charset="UTF-8", application/jsonpath
 *   return handleSearch(event);
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param mediaTypes A media type (with optional parameters) or an array of them.
 */
export function appendAcceptQuery(event: H3Event, mediaTypes: string | string[]): void {
  const list = Array.isArray(mediaTypes) ? mediaTypes : [mediaTypes];
  if (list.length === 0) {
    return;
  }
  // Append so multiple callers (e.g. middleware + handler) accumulate formats
  // into a single comma-separated Structured Fields List instead of clobbering.
  event.res.headers.append("accept-query", serializeAcceptQuery(list));
}

/**
 * Assert that the request `Content-Type` is present and one of the accepted
 * media types, following the requirements of RFC 10008 for the HTTP `QUERY`
 * method.
 *
 * Throws:
 *
 * - `400 Bad Request` if the `Content-Type` header is missing.
 *
 * - `422 Unprocessable Content` if the `Content-Type` header is malformed.
 *
 * - `415 Unsupported Media Type` if the media type is not accepted.
 *
 * Accepted types may use wildcards: `*` / `*&#47;*` match anything and
 * `type/*` matches any subtype of `type`.
 *
 * @example
 * app.query("/search", async (event) => {
 *   requireContentType(event, ["application/sql", "application/jsonpath"]);
 *   const body = await readBody(event, { type: "text" });
 *   // ...
 * });
 *
 * @param event The HTTPEvent passed by the handler.
 * @param acceptedTypes An accepted media type or an array of them.
 * @returns The matched request media type (lower-cased, without parameters).
 */
export function requireContentType(event: HTTPEvent, acceptedTypes: string | string[]): string {
  const header = event.req.headers.get("content-type");
  if (!header) {
    throw new HTTPError({
      status: 400,
      statusText: "Bad Request",
      message: "Content-Type header is required",
    });
  }

  const mediaType = baseMediaType(header);
  const slash = mediaType.indexOf("/");
  if (slash <= 0 || slash === mediaType.length - 1) {
    throw new HTTPError({
      status: 422,
      statusText: "Unprocessable Content",
      message: "Malformed Content-Type header",
    });
  }

  const accepted = Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes];
  // Strip parameters from accepted entries too so a parameterized accepted type
  // (e.g. "application/json; charset=utf-8") still matches the parameter-less
  // request media type computed above.
  if (accepted.some((type) => mediaTypeMatches(mediaType, baseMediaType(type)))) {
    return mediaType;
  }

  throw new HTTPError({
    status: 415,
    statusText: "Unsupported Media Type",
    message: `Unsupported Content-Type: ${mediaType}. Expected one of: ${accepted.join(", ")}`,
  });
}

/**
 * Options for `defineQueryHandler`'s GET equivalence.
 */
export interface QueryHandlerGetOptions {
  /**
   * URL search param carrying the query on GET/HEAD requests (default: `"q"`).
   */
  param?: string;

  /**
   * URL search param selecting the query format on GET/HEAD requests
   * (default: `"f"`). It may be omitted by clients when exactly one concrete
   * (non-wildcard) format is accepted.
   */
  formatParam?: string;
}

type QueryHandlerBase = Omit<EventHandlerObject, "handler" | "fetch"> & {
  formats: string[];
};

export function defineQueryHandler(
  def: QueryHandlerBase & {
    get?: undefined;
    body: false;
    handler: (event: H3Event, context: { format: string }) => unknown | Promise<unknown>;
  },
): EventHandlerWithFetch;

export function defineQueryHandler(
  def: QueryHandlerBase & {
    get?: true | string | QueryHandlerGetOptions;
    body?: true;
    handler: (
      event: H3Event,
      context: { format: string; query: string },
    ) => unknown | Promise<unknown>;
  },
): EventHandlerWithFetch;

/**
 * Define an HTTP `QUERY` method handler (RFC 10008) with the accepted query
 * `formats` enforced and advertised.
 *
 * The `formats` array lists the accepted query media types (wildcards like
 * `application/*` are supported). On every response — including error
 * responses — they are advertised via the `Accept-Query` header. The handler
 * receives the matched request media type as `format` (lower-cased, without
 * parameters) and the query text as `query`, read from the request body.
 *
 * Requests are rejected with `405` (non-`QUERY` method), `400` (missing
 * `Content-Type`), `422` (malformed `Content-Type`), or `415` (unsupported
 * query format).
 *
 * Set `body: false` to opt out of reading the request body: the handler then
 * receives only `{ format }` and reads the body itself (e.g. as a stream or
 * with a custom parser).
 *
 * With the `get` option, the same handler also serves an equivalent,
 * HTTP-cacheable GET (RFC 10008 §2.3): the query is read from the `?q=` URL
 * search param and the format from `?f=` (both names configurable), the handler
 * receives the resolved `query` on both paths, and successful QUERY responses
 * advertise the equivalent GET via `Content-Location` — preserving existing
 * search params, and skipped when the URL would exceed 2048 chars. The handler
 * gates the method itself (`405` for anything else), so a single `app.all`
 * route serves QUERY, GET, and HEAD. GET-path rejections are `400`. Pass
 * `get: true` for the default param names, a string to set the query param, or
 * an object to set both.
 *
 * @example
 * app.query("/books", defineQueryHandler({
 *   formats: ["application/sql", "application/jsonpath"],
 *   handler: (event, { format, query }) => runQuery(format, query),
 * }));
 *
 * @example
 * const searchBooks = defineQueryHandler({
 *   formats: ["application/sql", "application/jsonpath"],
 *   get: true,
 *   handler: (event, { format, query }) => runQuery(format, query),
 * });
 * app.all("/books", searchBooks);
 * // QUERY /books     -> 200 + Content-Location: /books?q=<query>&f=<format>
 * // GET /books?q=... -> same result, ordinary HTTP caching applies
 *
 * @param def Handler options: the accepted `formats`, the `handler`, optional `get` equivalence, optional `body: false` opt-out, plus optional `middleware` and `meta`.
 */
export function defineQueryHandler(
  def: QueryHandlerBase & {
    get?: true | string | QueryHandlerGetOptions;
    body?: boolean;
    handler: (event: H3Event, context: any) => unknown | Promise<unknown>;
  },
): EventHandlerWithFetch {
  if (def.formats.length === 0) {
    throw new TypeError("defineQueryHandler requires at least one format");
  }

  // Serialize once at definition time: validates the media types eagerly and
  // avoids re-serializing on every request.
  const acceptQuery = serializeAcceptQuery(def.formats);

  const getOpts =
    typeof def.get === "object"
      ? def.get
      : typeof def.get === "string"
        ? { param: def.get }
        : undefined;
  const get = def.get
    ? { param: getOpts?.param ?? "q", formatParam: getOpts?.formatParam ?? "f" }
    : undefined;

  // With a single concrete (non-wildcard) accepted format, GET requests may
  // omit the format param and `Content-Location` doesn't need to carry it.
  const defaultFormat =
    def.formats.length === 1 && !def.formats[0].includes("*")
      ? baseMediaType(def.formats[0])
      : undefined;

  // Read the query body as text by default, exposing it as `context.query`.
  // `get` always reads it (needed for the `query` context and `Content-Location`);
  // `body: false` opts out so the handler reads the body itself.
  const readBody = !!get || def.body !== false;

  return defineHandler({
    ...def,
    handler: function _queryHandler(event) {
      // Advertise the accepted formats on every response, including error
      // responses (405/415/...), so clients can discover the supported query
      // formats per RFC 10008.
      event.res.headers.append("accept-query", acceptQuery);
      event.res.errHeaders.append("accept-query", acceptQuery);

      const method = event.req.method;
      if (method !== "QUERY" && !(get && (method === "GET" || method === "HEAD"))) {
        throw new HTTPError({
          status: 405,
          statusText: "Method Not Allowed",
          headers: { allow: get ? "GET, HEAD, QUERY" : "QUERY" },
        });
      }

      if (method !== "QUERY") {
        // GET/HEAD equivalent of a QUERY request (RFC 10008 §2.3).
        return def.handler(event, resolveGetQuery(event, get!, def.formats, defaultFormat));
      }

      // Throws 400 (missing), 422 (malformed), or 415 (unsupported).
      const format = requireContentType(event, def.formats);

      if (!readBody) {
        return def.handler(event, { format });
      }

      return event.req.text().then((query) => {
        if (get) {
          setQueryContentLocation(event, get, query, format, defaultFormat);
        }
        return def.handler(event, { format, query });
      });
    },
  });
}
