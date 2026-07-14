export interface ResolveDotSegmentsOptions {
  /**
   * Also decode percent-encoded path separators (`%2f`, `%5c`) into real `/`
   * segment boundaries before resolving `.`/`..`.
   *
   * `event.url.pathname` never decodes `%2f` on its own, because doing so
   * would change how many segments a path has and therefore which route
   * matches — a correctness concern for dispatch, not just a security one
   * (e.g. `/files/:id` may rely on `%2F` to keep an id with a literal slash
   * as one opaque segment). So never use the result for routing/dispatch.
   *
   * Enable this for any out-of-band scope/security check whose result is
   * later handed to something that collapses `%2f` back to `/` on its own —
   * which is the common case, not an exotic one: an ordinary reverse proxy
   * (e.g. nginx with a trailing-slash `proxy_pass`) decodes `%2f`→`/` on every
   * request, so an encoded separator that dodges a narrower rule at match time
   * then escapes it downstream. If a scope check feeds a proxy or redirect
   * target, you almost certainly want this on.
   *
   * Decoding is pessimistic but bounded: it collapses a separator nested as
   * repeated whole `%25` prefixes (`%252f`, `%25252f`, ...) at any depth, so a
   * downstream that keeps `%25`-re-encoding and decoding cannot smuggle one
   * past. It does NOT catch a separator whose own hex digits are themselves
   * percent-encoded (`%25%32%66` → `%2f` → `/` after two decodes) — and that
   * form can appear even in an already-once-decoded pathname (from wire
   * `%2525%2532%2566`), so once-decoded input is not by itself sufficient.
   * Treat this as covering the common `%25`-nesting case, not as an absolute
   * guarantee against every multi-decode chain. Other escapes (e.g. `%20`) are
   * never decoded.
   *
   * @default false
   */
  decodeSlashes?: boolean;

  /**
   * Collapse runs of consecutive path separators (interior empty `//` segments)
   * instead of preserving them, producing the *maximal-traversal* canonical
   * form — the path a slash-merging downstream (nginx `merge_slashes`, or any
   * backend that decodes then normalizes) actually resolves. It operates on the
   * separator set that is active after the normalizations above: a literal `/`,
   * a `\` normalized to `/`, and — with {@link decodeSlashes} — a decoded
   * `%2f`/`%5c` (so the same bounded `%25`-nesting boundary is inherited, and a
   * hex-of-hex form like `%25%32%66` is no more collapsed here than it is
   * decoded there).
   *
   * This is the reading in which a `..` next to an empty segment is no longer
   * shielded by it: `/a//..` resolves to `/`, not `/a`. The two readings diverge
   * exactly there, so a scope check that only looks at the empty-preserving form
   * can pass a path that still escapes downstream. Enable this for a fail-closed
   * scope/security check that must also hold against a slash-merging downstream
   * — but note a `/`-splitting router (rou3) does not merge slashes, so this
   * form is one of two readings such a check has to consider, not a replacement
   * for the other. Never use the result for routing/dispatch.
   *
   * Only *runs* collapse: a single trailing slash is preserved (`/a/` stays
   * `/a/`, `/a//` becomes `/a/`), as with nginx.
   *
   * @default false
   */
  mergeSlashes?: boolean;
}

// A dot segment — the only `.`-related input that changes the path — is a `.`
// or `..` occupying a WHOLE segment, where each dot may be a literal `.` or a
// `%2e` escape at any `%25`-nesting depth. Matching it boundary-aware (bounded
// by `/` or the string edges) keeps a dotted filename (`app.1a2b.js`) or a
// non-dot escape (`%20`) on the fast path instead of the split/normalize loop.
const DOT_SEGMENT_SRC = String.raw`(?:^|/)(?:\.|%(?:25)*2e){1,2}(?:/|$)`;

// Encoded path separators (`%2f`/`%5c`) at any `%25`-nesting depth. Source
// string shared with the per-mode trigger regexes (so the pattern lives in one
// place); global form to decode every occurrence.
const ENCODED_SEP_SRC = String.raw`%(?:25)*(?:2f|5c)`;
const ENCODED_SEP_RE_G = /* @__PURE__ */ new RegExp(ENCODED_SEP_SRC, "gi");

// One combined trigger regex per option mode so the fast-path guard is a
// SINGLE scan of the path, indexed by `(decodeSlashes?1:0) | (mergeSlashes?2:0)`.
// Each alternative is the exact trigger of one slow-path transformation — `\`
// normalization, dot-segment resolution, and (per mode) `%2f`/`%5c` decoding
// and `//` run collapsing — so "no match" guarantees resolving is a no-op. An
// encoded separator only forms a run once decoded, so the `decodeSlashes`
// alternative already covers the runs `mergeSlashes` can additionally see; the
// leading-separator normalization happens before the guard, so a remaining
// `//` is interior or trailing.
const TRIGGER_RES = /* @__PURE__ */ (() => {
  const base = String.raw`\\|` + DOT_SEGMENT_SRC;
  return [
    new RegExp(base, "i"),
    new RegExp(`${base}|${ENCODED_SEP_SRC}`, "i"),
    new RegExp(`${base}|//`, "i"),
    new RegExp(`${base}|${ENCODED_SEP_SRC}|//`, "i"),
  ];
})();

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
 * A trailing `.`/`..` resolves to a directory and keeps its trailing slash
 * (`/a/b/..` -> `/a/`, `/a/.` -> `/a/`), per RFC 3986 §5.2.4 and matching what a
 * WHATWG/nginx downstream resolves — so a scope check sees the directory form,
 * not its file-form sibling.
 * Interior empty segments are preserved (`/a//b` stays `/a//b`) — like WHATWG,
 * this never merges slashes, so empty segments survive rather than collapsing.
 * The one exception is a *leading* run: it is always clamped to a single `/`
 * (WHATWG would keep `//host`), so only the leading slash is guaranteed single
 * and a consumer doing exact prefix matching should normalize its allowlist the
 * same way. To collapse interior runs too (the reading a slash-merging
 * downstream resolves), see {@link ResolveDotSegmentsOptions.mergeSlashes}.
 */
export function resolveDotSegments(path: string, opts?: ResolveDotSegmentsOptions): string {
  // Normalize to a single leading slash (treating a leading `\` as a
  // separator). This keeps the `..` root clamp below well-defined for
  // otherwise-relative inputs and prevents a protocol-relative result.
  if (path[0] !== "/" || path[1] === "/" || path[1] === "\\") {
    path = "/" + path.replace(/^[/\\]+/, "");
  }
  const decodeSlashes = opts?.decodeSlashes;
  const mergeSlashes = opts?.mergeSlashes;
  // Fast-path guard: one scan of the mode's combined trigger regex (see
  // TRIGGER_RES) — the common, already-canonical path returns here.
  if (!TRIGGER_RES[(decodeSlashes ? 1 : 0) | (mergeSlashes ? 2 : 0)]!.test(path)) {
    return path;
  }
  // Normalize backslashes to forward slashes to prevent traversal via `\`
  let normalized = path.includes("\\") ? path.replaceAll("\\", "/") : path;
  if (decodeSlashes) {
    normalized = normalized.replace(ENCODED_SEP_RE_G, "/");
  }
  const segments = normalized.split("/");
  const lastIndex = segments.length - 1;
  const resolved: string[] = [];
  for (let i = 0; i <= lastIndex; i++) {
    const segment = segments[i]!;
    // Decode percent-encoded dots at any %25-nesting depth (%2e, %252e, ...)
    // to catch multi-encoded traversal — skipped for the common `%`-free
    // segment, which cannot contain an encoded dot.
    const normalizedSegment = segment.includes("%")
      ? segment.replace(ENCODED_DOT_RE_G, ".")
      : segment;
    const isDotSegment = normalizedSegment === "." || normalizedSegment === "..";
    if (normalizedSegment === "..") {
      // Never pop past the root (first empty segment from leading slash)
      if (resolved.length > 1) {
        resolved.pop();
      }
    } else if (mergeSlashes && normalizedSegment === "" && i > 0 && i < lastIndex) {
      // Drop an empty segment that is neither the root (`i === 0`, always empty
      // since `path` starts with `/`) nor the trailing one — exactly the
      // separators a `/{2,}` -> `/` collapse would remove. Skipping them here,
      // rather than collapsing the string first, is equivalent and lets a `..`
      // that an empty segment would otherwise shield pop its real parent.
    } else if (!isDotSegment) {
      resolved.push(segment);
    }
    // A trailing `.`/`..` resolves to a directory, so preserve the trailing
    // slash by leaving an empty final segment (`/a/b/..` -> `/a/`, `/a/.` ->
    // `/a/`). This matches RFC 3986 §5.2.4 and what a WHATWG/nginx downstream
    // resolves, so a scope check does not see the file-form sibling of a path
    // the downstream serves the directory index of.
    if (isDotSegment && i === lastIndex) {
      resolved.push("");
    }
  }
  const result = resolved.join("/") || "/";
  // Decoded/normalized separators can prepend extra empty segments; collapse
  // any leading run to a single slash so the result stays a single-rooted, non
  // protocol-relative path. (A no-op when there is already one leading slash.)
  return result.replace(/^\/+/, "/");
}

/**
 * Whether `path` is already in the canonical form {@link resolveDotSegments}
 * produces under the same options — i.e. resolving it is guaranteed to be a
 * no-op. Exact in both directions: `isCanonicalPath(path, opts)` is `true` if
 * and only if `resolveDotSegments(path, opts) === path`.
 *
 * This is the resolver's own fast-path guard, exported so a caller that
 * canonicalizes on a hot path (per-request scope or rule matching) can skip
 * the call — and any derived work — without duplicating knowledge of what the
 * resolver decodes. Checking here and resolving elsewhere with different
 * options voids the guarantee: pass the exact options the later call uses, or
 * stricter ones (`decodeSlashes`/`mergeSlashes` enabled is strictly more
 * sensitive, so a `true` result with both on implies `true` for every mode).
 *
 * Like the resolver, this never inspects a query/hash — callers pass a bare
 * pathname.
 */
export function isCanonicalPath(path: string, opts?: ResolveDotSegmentsOptions): boolean {
  return (
    path[0] === "/" &&
    path[1] !== "/" &&
    path[1] !== "\\" &&
    !TRIGGER_RES[(opts?.decodeSlashes ? 1 : 0) | (opts?.mergeSlashes ? 2 : 0)]!.test(path)
  );
}
