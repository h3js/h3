/**
 * Evaluate an `If-None-Match` field-value against an ETag using the weak
 * comparison function (RFC 9110 §8.8.3.2 and §13.1.2).
 *
 * - `*` matches any current representation.
 * - The field-value is a comma-separated list of entity-tags. An opaque-tag is
 *   a quoted string whose value may itself contain commas, so tags are matched
 *   by their quoted boundaries rather than by naive comma splitting.
 * - Weak comparison ignores the `W/` weakness indicator on either side.
 */
export function matchETag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") {
    return true;
  }
  const target = opaqueTag(etag);
  return splitETags(ifNoneMatch).some((tag) => opaqueTag(tag.trim()) === target);
}

/**
 * Evaluate an `If-Match` field-value against an ETag using the strong
 * comparison function (RFC 9110 §8.8.3.2 and §13.1.1).
 *
 * - `*` matches any current representation.
 * - Weak entity-tags never match in strong comparison.
 */
export function matchETagStrong(ifMatch: string, etag: string): boolean {
  if (ifMatch.trim() === "*") {
    return true;
  }
  if (!etag || /^W\//i.test(etag)) {
    return false;
  }
  return splitETags(ifMatch).some((tag) => {
    const trimmed = tag.trim();
    return !/^W\//i.test(trimmed) && trimmed === etag;
  });
}

/**
 * Compare last-modified timestamp with an HTTP-date header at 1-second resolution.
 * Returns `undefined` for missing or invalid dates.
 */
export function isModifiedSince(
  lastModified?: Date,
  header?: string | null,
): boolean | undefined {
  if (!lastModified || !header) {
    return;
  }
  const since = Date.parse(header);
  const modified = lastModified.getTime();
  if (Number.isNaN(since) || Number.isNaN(modified)) {
    return;
  }
  return Math.floor(modified / 1000) * 1000 > since;
}

/**
 * Precedence of RFC 9110 §13.2.2 for GET and HEAD requests.
 * Evaluates `If-Match`, `If-Unmodified-Since`, `If-None-Match`, and `If-Modified-Since`.
 * Returns 412 (Precondition Failed), 304 (Not Modified), or undefined (perform request).
 */
export function evaluatePreconditions(
  headers: Headers,
  validators: {
    etag?: string;
    lastModified?: Date;
  },
): 304 | 412 | undefined {
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null) {
    if (!validators.etag || !matchETagStrong(ifMatch, validators.etag)) {
      return 412;
    }
  } else {
    const ifUnmodifiedSince = headers.get("if-unmodified-since");
    if (ifUnmodifiedSince && isModifiedSince(validators.lastModified, ifUnmodifiedSince)) {
      return 412;
    }
  }

  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    if (validators.etag && matchETag(ifNoneMatch, validators.etag)) {
      return 304;
    }
  } else {
    const ifModifiedSince = headers.get("if-modified-since");
    if (ifModifiedSince && isModifiedSince(validators.lastModified, ifModifiedSince) === false) {
      return 304;
    }
  }
}

/**
 * Evaluate an incoming conditional request against the current representation's
 * validators, returning `true` when it matches and a `304 Not Modified` should
 * be sent.
 *
 * RFC 9110 §13.1.3: a recipient MUST ignore `If-Modified-Since` when the request
 * contains an `If-None-Match` header field. `If-None-Match` takes precedence;
 * `If-Modified-Since` is only evaluated when it is absent. A present-but-empty
 * `If-None-Match` is malformed and treated as absent.
 */
export function isCacheMatch(
  headers: Headers,
  validators: {
    etag?: string;
    lastModified?: Date;
    /** Overrides the request header, for a caller holding the original value. */
    ifNoneMatch?: string;
    /** Overrides the request header, for a caller holding the original value. */
    ifModifiedSince?: string;
  },
): boolean {
  const ifNoneMatch = validators.ifNoneMatch ?? headers.get("if-none-match");
  if (ifNoneMatch) {
    return !!validators.etag && matchETag(ifNoneMatch, validators.etag);
  }
  if (validators.lastModified) {
    const ifModifiedSince = validators.ifModifiedSince ?? headers.get("if-modified-since");
    return !!ifModifiedSince && new Date(ifModifiedSince) >= validators.lastModified;
  }
  return false;
}

function opaqueTag(tag: string): string {
  return tag.replace(/^W\//i, "");
}

/**
 * Split an `If-None-Match` list into entity-tags, treating commas inside a
 * quoted opaque-tag as literal. A `"` cannot appear within an opaque-tag
 * (RFC 9110 §8.8.3), so it unambiguously toggles the quoted state.
 */
function splitETags(value: string): string[] {
  const tags: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      tags.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tags.push(current);
  return tags;
}
