import { HTTPError } from "../error.ts";

import type { H3Event, HTTPEvent } from "../event.ts";

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
 *   setResponseAcceptQuery(event, ["application/sql;charset=UTF-8", "application/jsonpath"]);
 *   // Accept-Query: application/sql;charset="UTF-8", application/jsonpath
 *   return handleSearch(event);
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param mediaTypes A media type (with optional parameters) or an array of them.
 * @see {@link getResponseAcceptQuery}
 */
export function setResponseAcceptQuery(event: H3Event, mediaTypes: string | string[]): void {
  const list = Array.isArray(mediaTypes) ? mediaTypes : [mediaTypes];
  if (list.length === 0) {
    return;
  }
  const value = list.map(serializeMediaType).join(", ");
  event.res.headers.set("accept-query", value);
}

/**
 * Read the `Accept-Query` media types previously set on the response via
 * {@link setResponseAcceptQuery}.
 *
 * The Structured Fields List is parsed back into an array of media type strings
 * with any quoted parameter values unquoted (e.g. `application/sql;charset="UTF-8"`
 * becomes `application/sql;charset=UTF-8`). Returns an empty array if the header
 * is not set.
 *
 * @example
 * const accepted = getResponseAcceptQuery(event); // ["application/sql;charset=UTF-8"]
 *
 * @param event The H3Event passed by the handler.
 * @see {@link setResponseAcceptQuery}
 */
export function getResponseAcceptQuery(event: H3Event): string[] {
  const header = event.res.headers.get("accept-query");
  if (!header) {
    return [];
  }
  return splitOutsideQuotes(header, ",")
    .map((member) => parseMediaType(member.trim()))
    .filter(Boolean);
}

/**
 * Assert that the request `Content-Type` is present and one of the accepted
 * media types, following the requirements of RFC 10008 for the HTTP `QUERY`
 * method.
 *
 * Throws:
 * - `400 Bad Request` if the `Content-Type` header is missing.
 * - `422 Unprocessable Content` if the `Content-Type` header is malformed.
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

  const mediaType = header.split(";")[0].trim().toLowerCase();
  if (!mediaType.includes("/")) {
    throw new HTTPError({
      status: 422,
      statusText: "Unprocessable Content",
      message: "Malformed Content-Type header",
    });
  }

  const accepted = Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes];
  if (accepted.some((type) => mediaTypeMatches(mediaType, type.trim().toLowerCase()))) {
    return mediaType;
  }

  throw new HTTPError({
    status: 415,
    statusText: "Unsupported Media Type",
    message: `Unsupported Content-Type: ${mediaType}. Expected one of: ${accepted.join(", ")}`,
  });
}

// --- internal helpers ---

// sf-token: ( ALPHA / "*" ) *( tchar / ":" / "/" ) — https://www.rfc-editor.org/rfc/rfc8941#section-3.3.4
const SF_TOKEN_RE = /^[A-Za-z*][\w!#$%&'*+.^`|~:/-]*$/;
// sf-key: ( lcalpha / "*" ) *( lcalpha / DIGIT / "_" / "-" / "." / "*" )
const SF_KEY_RE = /^[a-z*][a-z0-9_.*-]*$/;

/** Serialize a `type/subtype;param=value` media type into a Structured Fields item. */
function serializeMediaType(mediaType: string): string {
  const parts = splitOutsideQuotes(mediaType, ";");
  const base = parts[0].trim();
  if (!SF_TOKEN_RE.test(base)) {
    throw new TypeError(`Invalid media type: ${JSON.stringify(mediaType)}`);
  }
  let result = base;
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i].trim();
    if (!param) {
      continue;
    }
    const eq = param.indexOf("=");
    const key = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
    if (!SF_KEY_RE.test(key)) {
      throw new TypeError(`Invalid media type parameter: ${JSON.stringify(param)}`);
    }
    // Bare parameters serialize to the boolean `true` (an implicit `;key`).
    result +=
      eq === -1 ? `;${key}` : `;${key}="${escapeQuotes(unquote(param.slice(eq + 1).trim()))}"`;
  }
  return result;
}

/** Parse a Structured Fields item back into a `type/subtype;param=value` media type. */
function parseMediaType(member: string): string {
  const parts = splitOutsideQuotes(member, ";");
  let result = parts[0].trim();
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i].trim();
    if (!param) {
      continue;
    }
    const eq = param.indexOf("=");
    result +=
      eq === -1
        ? `;${param}`
        : `;${param.slice(0, eq).trim()}=${unquote(param.slice(eq + 1).trim())}`;
  }
  return result;
}

function mediaTypeMatches(mediaType: string, accepted: string): boolean {
  if (accepted === "*/*" || accepted === "*") {
    return true;
  }
  if (accepted === mediaType) {
    return true;
  }
  if (accepted.endsWith("/*")) {
    return mediaType.startsWith(accepted.slice(0, -1));
  }
  return false;
}

/** Split on `sep` while ignoring separators inside double-quoted strings. */
function splitOutsideQuotes(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      current += ch;
      if (ch === "\\" && i + 1 < input.length) {
        current += input[++i];
      } else if (ch === '"') {
        inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
      current += ch;
    } else if (ch === sep) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function escapeQuotes(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function unquote(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}
