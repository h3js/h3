import { HTTPError } from "../error.ts";
import { defineHandler } from "../handler.ts";
import { serializeAcceptQuery, baseMediaType, mediaTypeMatches } from "./internal/media-type.ts";

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
 * Define an HTTP `QUERY` method handler (RFC 10008) with the accepted query
 * `formats` enforced and advertised.
 *
 * The `formats` array lists the accepted query media types (wildcards like
 * `application/*` are supported). On every response — including error
 * responses — they are advertised via the `Accept-Query` header. The handler
 * receives the matched request media type as `format` (lower-cased, without
 * parameters) and reads the query from the request body as usual.
 *
 * Requests are rejected with `405` (non-`QUERY` method), `400` (missing
 * `Content-Type`), `422` (malformed `Content-Type`), or `415` (unsupported
 * query format).
 *
 * @example
 * app.query("/books", defineQueryHandler({
 *   formats: ["application/sql", "application/jsonpath"],
 *   handler: async (event, { format }) => {
 *     const query = await readBody(event, { type: "text" });
 *     return runQuery(format, query);
 *   },
 * }));
 *
 * @param def Handler options: the accepted `formats`, the `handler`, plus optional `middleware` and `meta`.
 */
export function defineQueryHandler(
  def: Omit<EventHandlerObject, "handler" | "fetch"> & {
    formats: string[];
    handler: (event: H3Event, context: { format: string }) => unknown | Promise<unknown>;
  },
): EventHandlerWithFetch {
  if (def.formats.length === 0) {
    throw new TypeError("defineQueryHandler requires at least one format");
  }

  // Serialize once at definition time: validates the media types eagerly and
  // avoids re-serializing on every request.
  const acceptQuery = serializeAcceptQuery(def.formats);

  return defineHandler({
    ...def,
    handler: function _queryHandler(event) {
      // Advertise the accepted formats on every response, including error
      // responses (405/415/...), so clients can discover the supported query
      // formats per RFC 10008.
      event.res.headers.append("accept-query", acceptQuery);
      event.res.errHeaders.append("accept-query", acceptQuery);

      if (event.req.method !== "QUERY") {
        throw new HTTPError({
          status: 405,
          statusText: "Method Not Allowed",
          headers: { allow: "QUERY" },
        });
      }

      // Throws 400 (missing), 422 (malformed), or 415 (unsupported).
      const format = requireContentType(event, def.formats);

      return def.handler(event, { format });
    },
  });
}
