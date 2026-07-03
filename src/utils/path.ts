export interface ResolveDotSegmentsOptions {
  /**
   * Also decode percent-encoded path separators (`%2f`, `%5c`) into real `/`
   * segment boundaries before resolving `.`/`..`.
   *
   * `event.url.pathname` never decodes `%2f` on its own, because doing so
   * would change how many segments a path has and therefore which route
   * matches — a correctness concern for dispatch, not just a security one
   * (e.g. `/files/:id` may rely on `%2F` to keep an id with a literal slash
   * as one opaque segment).
   *
   * Enable this only for out-of-band scope/security checks that must
   * anticipate a downstream decode — e.g. a reverse-proxy target or redirect
   * that will collapse `%2f` back to `/` on its own, letting an encoded
   * segment dodge a narrower rule at match time and then escape it once
   * decoded downstream. Never use the result for routing/dispatch.
   *
   * Decoding is pessimistic: nested `%25`-encodings of a separator
   * (`%252f`, `%25252f`, ...) are collapsed too, so a downstream that
   * decodes any number of times cannot smuggle a separator past the check.
   * Other escapes (e.g. `%20`) are never decoded.
   *
   * @default false
   */
  decodeSlashes?: boolean;
}

// A dot segment — the only `.`-related input that changes the path — is a `.`
// or `..` occupying a WHOLE segment, where each dot may be a literal `.` or a
// `%2e` escape at any `%25`-nesting depth. Matching it boundary-aware (bounded
// by `/` or the string edges) keeps a dotted filename (`app.1a2b.js`) or a
// non-dot escape (`%20`) on the fast path instead of the split/normalize loop.
const DOT_SEGMENT_RE = /(?:^|\/)(?:\.|%(?:25)*2e){1,2}(?:\/|$)/i;

// Encoded path separators (`%2f`/`%5c`) at any `%25`-nesting depth. Test form
// for the fast-path guard; global form to decode every occurrence.
const ENCODED_SEP_RE = /%(?:25)*(?:2f|5c)/i;
const ENCODED_SEP_RE_G = /%(?:25)*(?:2f|5c)/gi;

// Percent-encoded dots at any `%25`-nesting depth, for per-segment decoding.
const ENCODED_DOT_RE_G = /%(?:25)*2e/gi;

/**
 * Resolve `.` and `..` segments in a path, without ever escaping above the
 * root `/`. The result is always an absolute path with a single leading `/`,
 * so it can never be protocol-relative (`//host`).
 *
 * Also decodes percent-encoded dot segments at any `%25`-nesting depth
 * (`%2e`, `%252e`, ...) and normalizes `\` to `/`, so encoded or
 * backslash-based traversal (e.g. `%2e%2e/`, `..\..\`) is caught the same
 * way as a literal `../`.
 *
 * `%2f`/`%5c` (encoded path separators) are left untouched by default — see
 * {@link ResolveDotSegmentsOptions.decodeSlashes}.
 *
 * Only `.`/`..` resolution and the decodes above alter the string; every other
 * percent-encoding (`%20`, non-ASCII, `%3A`, and any `%2e` not forming a whole
 * segment) is left intact, so the result stays in the same representation as an
 * un-decoded `event.url.pathname` and matches routes/rules consistently.
 * Interior empty segments are preserved (`/a//b` stays `/a//b`, per WHATWG URL
 * normalization) — only the leading slash is guaranteed single, so a consumer
 * doing exact prefix matching should normalize its allowlist the same way.
 */
export function resolveDotSegments(path: string, opts?: ResolveDotSegmentsOptions): string {
  // Normalize to a single leading slash (treating a leading `\` as a
  // separator). This keeps the `..` root clamp below well-defined for
  // otherwise-relative inputs and prevents a protocol-relative result.
  if (path[0] !== "/" || path[1] === "/" || path[1] === "\\") {
    path = "/" + path.replace(/^[/\\]+/, "");
  }
  const decodeSlashes = opts?.decodeSlashes;
  // A `\` always needs normalizing, and (with `decodeSlashes`) an encoded
  // separator always needs decoding — both are cheap `includes`/`test` scans
  // checked first so a dot-free path skips the dot-segment regex entirely.
  const hasBackslash = path.includes("\\");
  const hasEncodedSep = decodeSlashes && ENCODED_SEP_RE.test(path);
  if (!hasBackslash && !hasEncodedSep && !DOT_SEGMENT_RE.test(path)) {
    return path;
  }
  // Normalize backslashes to forward slashes to prevent traversal via `\`
  let normalized = hasBackslash ? path.replaceAll("\\", "/") : path;
  if (hasEncodedSep) {
    normalized = normalized.replace(ENCODED_SEP_RE_G, "/");
  }
  const segments = normalized.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    // Decode percent-encoded dots at any %25-nesting depth (%2e, %252e, ...)
    // to catch multi-encoded traversal — skipped for the common `%`-free
    // segment, which cannot contain an encoded dot.
    const normalizedSegment = segment.includes("%")
      ? segment.replace(ENCODED_DOT_RE_G, ".")
      : segment;
    if (normalizedSegment === "..") {
      // Never pop past the root (first empty segment from leading slash)
      if (resolved.length > 1) {
        resolved.pop();
      }
    } else if (normalizedSegment !== ".") {
      resolved.push(segment);
    }
  }
  const result = resolved.join("/") || "/";
  // Decoded/normalized separators can prepend extra empty segments; collapse
  // them so the result stays a single-rooted, non protocol-relative path.
  return result[1] === "/" ? result.replace(/^\/+/, "/") : result;
}
