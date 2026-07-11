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
  validators: { etag?: string; lastModified?: Date },
): boolean {
  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch) {
    return !!validators.etag && matchETag(ifNoneMatch, validators.etag);
  }
  if (validators.lastModified) {
    const ifModifiedSince = headers.get("if-modified-since");
    return !!ifModifiedSince && new Date(ifModifiedSince) >= validators.lastModified;
  }
  return false;
}

function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
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
