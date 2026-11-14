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
 * validators, returning `true` when it matches. The caller determines the
 * applicable validators and response status for the request method.
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

/**
 * Evaluate `If-Match` and `If-Unmodified-Since` against the current
 * representation, returning `true` when the precondition fails (a `412`).
 *
 * RFC 9110 §13.1.1 and §13.2.2: `If-Match` uses the strong comparison function
 * (a weak ETag never matches, `*` matches any existing representation) and
 * `If-Unmodified-Since` is only evaluated when `If-Match` is absent. A value that
 * isn't an HTTP-date is ignored. An empty `If-Match` lists no tags, so it fails.
 */
export function isPreconditionFailed(
  headers: Headers,
  validators: { etag?: string; lastModified?: Date },
): boolean {
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null) {
    if (ifMatch.trim() === "*") {
      return false;
    }
    const etag = validators.etag;
    return (
      !etag || etag.startsWith("W/") || !splitETags(ifMatch).some((tag) => tag.trim() === etag)
    );
  }
  const ifUnmodifiedSince = headers.get("if-unmodified-since");
  if (ifUnmodifiedSince && validators.lastModified) {
    const date = parseHTTPDate(ifUnmodifiedSince);
    return !!date && validators.lastModified > date;
  }
  return false;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// IMF-fixdate, then the obsolete RFC 850 and asctime forms (RFC 9110 §5.6.7).
const IMF_FIXDATE_RE =
  /^([A-Z][a-z]{2}), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const RFC850_DATE_RE =
  /^([A-Z][a-z]{5,8}), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const ASCTIME_DATE_RE =
  /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

/** Parse an HTTP-date, returning `undefined` for anything else (RFC 9110 §13.1.4). */
function parseHTTPDate(value: string): Date | undefined {
  let day: string, dd: string, mon: string, year: number, hh: string, mm: string, ss: string;
  let match: RegExpExecArray | null;
  if ((match = IMF_FIXDATE_RE.exec(value))) {
    [, day, dd, mon, , hh, mm, ss] = match;
    year = Number(match[4]);
    if (!DAY_NAMES.includes(day)) return undefined;
  } else if ((match = RFC850_DATE_RE.exec(value))) {
    [, day, dd, mon, , hh, mm, ss] = match;
    if (!LONG_DAY_NAMES.includes(day)) return undefined;
    // A two-digit year more than 50 years in the future is the most recent
    // past year with the same last two digits (RFC 9110 §5.6.7).
    const currentYear = new Date().getUTCFullYear();
    year = Math.floor(currentYear / 100) * 100 + Number(match[4]);
    if (year > currentYear + 50) year -= 100;
  } else if ((match = ASCTIME_DATE_RE.exec(value))) {
    // asctime carries no zone but is always UTC.
    [, day, mon, dd, hh, mm, ss] = match;
    year = Number(match[7]);
    if (!DAY_NAMES.includes(day)) return undefined;
  } else {
    return undefined;
  }
  const month = MONTHS.indexOf(mon);
  const date = new Date(Date.UTC(year, month, Number(dd), Number(hh), Number(mm), Number(ss)));
  // Reject out-of-range fields that `Date.UTC` would roll over, like 31 Feb.
  if (
    month < 0 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== Number(dd) ||
    date.getUTCHours() !== Number(hh) ||
    date.getUTCMinutes() !== Number(mm) ||
    date.getUTCSeconds() !== Number(ss)
  ) {
    return undefined;
  }
  return date;
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
