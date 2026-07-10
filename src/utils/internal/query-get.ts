// Internal helpers for `defineQueryHandler`'s GET equivalence (RFC 10008 §2.3).

import { HTTPError } from "../../error.ts";
import { baseMediaType, mediaTypeMatches } from "./media-type.ts";

import type { H3Event } from "../../event.ts";

export interface QueryGetOptions {
  param: string;
  formatParam: string;
}

// Long queries are the reason QUERY exists: skip the `Content-Location`
// advertisement when the equivalent GET URL would risk hitting URL length
// limits in browsers and intermediaries.
const MAX_CONTENT_LOCATION_LENGTH = 2048;

/**
 * Resolve the query and its format from the URL search params of a GET/HEAD
 * request equivalent to a QUERY request (RFC 10008 §2.3).
 *
 * All rejections are `400 Bad Request`: unlike the QUERY path, a GET carries
 * no content for `415`/`422` to apply to.
 */
export function resolveGetQuery(
  event: H3Event,
  get: QueryGetOptions,
  formats: string[],
  defaultFormat: string | undefined,
): { format: string; query: string } {
  const query = event.url.searchParams.get(get.param);
  if (query === null) {
    throw new HTTPError({
      status: 400,
      statusText: "Bad Request",
      message: `Missing \`?${get.param}=\` query parameter`,
    });
  }

  const formatParam = event.url.searchParams.get(get.formatParam);
  let format: string;
  if (formatParam) {
    format = baseMediaType(formatParam);
    if (!formats.some((type) => mediaTypeMatches(format, baseMediaType(type)))) {
      throw new HTTPError({
        status: 400,
        statusText: "Bad Request",
        message: `Unsupported query format: ${format}. Expected one of: ${formats.join(", ")}`,
      });
    }
  } else if (defaultFormat) {
    format = defaultFormat;
  } else {
    // Multiple (or wildcard) accepted formats: defaulting silently would
    // change the query semantics (e.g. SQL vs JSONPath), so require the param.
    throw new HTTPError({
      status: 400,
      statusText: "Bad Request",
      message: `Missing \`?${get.formatParam}=\` query parameter. Expected one of: ${formats.join(", ")}`,
    });
  }

  return { format, query };
}

/**
 * Advertise the equivalent, HTTP-cacheable GET for this exact query on a
 * QUERY response via `Content-Location` (RFC 10008 §2.3), preserving the
 * request's existing search params.
 */
export function setQueryContentLocation(
  event: H3Event,
  get: QueryGetOptions,
  query: string,
  format: string,
  defaultFormat: string | undefined,
): void {
  const params = new URLSearchParams(event.url.search);
  params.set(get.param, query);
  if (!defaultFormat) {
    params.set(get.formatParam, format);
  }
  const location = `${event.url.pathname}?${params}`;
  if (location.length <= MAX_CONTENT_LOCATION_LENGTH) {
    event.res.headers.set("content-location", location);
  }
}
