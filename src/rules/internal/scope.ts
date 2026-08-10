import { isCanonicalPath, resolveDotSegments } from "../../utils/path.ts";

// The two canonical readings a security check has to consider, kept here as the
// single place that knows what h3 decodes. `isCanonicalPath` is h3's own
// fast-path guard (`src/utils/path.ts`), so `needsCanonicalPasses` cannot desync
// from the resolver the way a local copy of the decode set would.
//
// `decodeSlashes` closes the one residual gap in h3's once-decoded pathname
// (`ResolveDotSegmentsOptions` documents the full input contract): h3 already resolves
// dot-segment traversals and leaves only `%2f` opaque, so decoding it here too
// makes the reading match what a downstream that collapses `%2f` back to `/`
// resolves. Other encodings round-trip unchanged.
const CANONICAL_OPTS = { decodeSlashes: true } as const;

// `mergeSlashes` adds the *maximal-traversal* reading — the path a slash-merging
// downstream (nginx `merge_slashes`) resolves, where a `..` is no longer shielded
// by an empty `//` segment. It inherits `decodeSlashes`'s separator set, so the
// `%25`-nesting boundary stays defined in exactly one place upstream.
//
// That nesting (`%252f` …) is defense-in-depth for a double-decoding downstream
// (proxy decodes, backend decodes again) — not purely fail-closed, since the
// dual-path union may override with a narrower, weaker rule a double-decoding
// downstream would actually resolve to. Tightening it belongs in
// `resolveDotSegments` (`src/utils/path.ts`), not here.
const MERGED_OPTS = { decodeSlashes: true, mergeSlashes: true } as const;

/**
 * h3's canonical reading of a pathname, with encoded separators decoded. Feeds
 * rule matching / auth / scope checks — never use for routing/dispatch.
 */
export function canonicalPath(pathname: string): string {
  return resolveDotSegments(pathname, CANONICAL_OPTS);
}

/**
 * Whether either canonical reading can differ from `pathname` itself. `false`
 * means the path is already canonical under the strictest reading — and since
 * h3's guard is exact and its options only *add* triggers, that implies it is
 * canonical under every weaker reading too, so both extra passes would return
 * `pathname` unchanged and the caller can skip them along with any work derived
 * from them.
 *
 * Only `false` skips work, and `false` is exact; a `true` verdict is merely
 * conservative (h3 scans a query string as if it were path), so a caller passing
 * something other than a bare pathname loses the fast path, never the check.
 */
export function needsCanonicalPasses(pathname: string): boolean {
  return !isCanonicalPath(pathname, MERGED_OPTS);
}

/**
 * Canonical form under a slash-merging downstream (e.g. nginx `merge_slashes`):
 * separator runs collapse, so a `..` no longer shielded by an empty `//` segment
 * is caught. Returns `undefined` when it agrees with `canonical` — the caller
 * already has that reading. Never use the result for routing/dispatch or
 * forwarding.
 *
 * Pass the `canonicalPath` result for the same `pathname`.
 *
 * This always resolves, so a non-canonical path costs two passes. Two shortcuts
 * look tempting and are both wrong:
 * - Pre-testing `pathname` for a separator run with a local regex (what this
 *   used to do) reintroduces a copy of h3's decode set that goes stale silently.
 * - Deriving the merged reading from `canonical`, or skipping when `canonical` is
 *   itself merge-canonical, is **unsound**: for `/a//../b` the `..` is consumed
 *   during the plain pass, leaving `/a/b` — merge-canonical, yet the merged
 *   reading of the original is `/b`. Skipping there drops a real escape.
 * Resolving `pathname` twice is the cost of two independent readings.
 */
export function mergedCanonicalPath(pathname: string, canonical: string): string | undefined {
  const merged = resolveDotSegments(pathname, MERGED_OPTS);
  return merged === canonical ? undefined : merged;
}

/**
 * Whether `pathname` stays within `base` once canonicalized. Security-critical:
 * an encoded traversal like `..%2f` must not escape a `/**` proxy/redirect scope
 * once a downstream decodes it.
 *
 * Fails closed under both readings — h3's canonical form (preserves empty `//`
 * segments) and the slash-merged form — since a `..` next to an empty segment is
 * in-scope under one but a traversal under the other.
 *
 * **Empty base allows everything, by contract** — there is no scope to escape.
 * That makes it useless as a *check*: a caller validating a forwarded target
 * whose base may be empty (an origin-root `to: "https://internal/**"`, or a bare
 * `to: "/**"`) gets an unconditional `true` and no validation at all. Such
 * callers must handle the root case explicitly instead of relying on this —
 * see `isFinalTargetInScope` in `../handlers/_utils.ts`, which rejects the one
 * escape a root still has (a leading separator run a decoding downstream reads
 * as an authority). Do not "fix" this by failing closed here: the empty-base
 * allow is load-bearing for the callers that pass a genuinely unscoped base.
 */
export function isPathInScope(pathname: string, base: string): boolean {
  if (!base) {
    return true;
  }
  // Already canonical under both readings: one check on `pathname` itself.
  if (!needsCanonicalPasses(pathname)) {
    return isCanonicalInScope(pathname, base);
  }
  return (
    isCanonicalInScope(canonicalPath(pathname), base) &&
    isCanonicalInScope(resolveDotSegments(pathname, MERGED_OPTS), base)
  );
}

function isCanonicalInScope(canonical: string, base: string): boolean {
  return canonical === base || canonical.startsWith(base + "/");
}
