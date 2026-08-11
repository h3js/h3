import { isCanonicalPath, resolveDotSegments } from "../../utils/path.ts";
import { decodePreservingSeparators } from "../../utils/internal/path.ts";

// The two canonical readings a security check has to consider, kept here as the
// single place that knows what h3 decodes. `isCanonicalPath` is h3's own
// fast-path guard (`src/utils/path.ts`), so `needsCanonicalPasses` cannot desync
// from the resolver the way a local copy of the decode set would.
//
// `decodeSlashes` closes the separator gap in h3's served pathname
// (`ResolveDotSegmentsOptions` documents the full input contract): h3 already resolves
// dot-segment traversals and leaves `%2f`/`%5c` opaque, so decoding them here too
// makes the reading match what a downstream that collapses them back to `/`
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
 * The reading a downstream that percent-decodes the path resolves: every escape
 * `event.url.pathname` still carries is decoded, **except** the path separators
 * (left to {@link canonicalPath}'s `decodeSlashes`, so the `%25`-nesting
 * boundary stays defined in exactly one place).
 *
 * h3's pathname decodes only the *needless* escapes — those whose character
 * survives WHATWG path serialization (see `canonicalPathname`), so `/%40admin`
 * is already served as `/@admin`. What it still carries encoded is everything
 * the serializer would re-add (`%20`, non-ASCII, `%22 %3C %3E %5E %60 %7B %7D`),
 * the C0 controls, and `%25` at any nesting depth. A rule pattern is written
 * with the character itself (`/a b/**`, `/café/**`), so matching only the served
 * spelling lets `/a%20b/...` slip past the gate while a proxied backend (or any
 * decoding consumer) resolves it back.
 *
 * Never use the result for routing/dispatch or forwarding — like the canonical
 * readings, it exists to make a security check see every spelling of the path.
 *
 * Decoding runs to a fixpoint, so a `%25`-nested escape (`%2520` → `%20` → ` `)
 * is caught for the same double-decoding downstream that `resolveDotSegments`
 * already covers for dots and separators (`%252e`, `%252f`) — a single pass here
 * would leave the two inconsistent, and `%2540admin` reachable past a
 * `/@admin/**` gate. It cannot collapse a separator: `decodePreservingSeparators`
 * holds `%2f`/`%5c` back at every `%25` depth, so those are already at their
 * fixpoint on the first pass.
 *
 * **The fixpoint is reached in a bounded number of passes** — see
 * {@link EXACT_PASSES}. A pass unwraps one `%25` level and rescans the whole
 * string, so termination alone (every changing pass shortens the string) left
 * a nested chain costing one full pass per level: quadratic, and reachable from
 * a single request that matches no rule at all. The bound never truncates the
 * reading: past the window a pass first unwraps the nesting *whole*, so a chain
 * of any depth still decodes to the same character it always did — a deeper
 * spelling can never degrade into "no alternate reading" and walk a gate.
 *
 * Returns `pathname` unchanged when there is nothing to decode, and stops at the
 * last well-formed reading on malformed percent-encoding — including one a
 * decode *produces* (`/a%25zzb` → `/a%zzb`), which h3 serves with a 200 since
 * `decodeURI` accepts it. Such a path keeps the reading decoded so far rather
 * than losing the match.
 */
export function decodedPath(pathname: string): string {
  let decoded = pathname;
  for (let pass = 0; hasDecodableEscape(decoded); pass++) {
    if (pass >= MAX_PASSES) {
      return decoded;
    }
    // Past the exact window, take the nesting out of the chain in one linear
    // scan instead of one pass per level. Only the passes a real double/triple
    // decoding consumer can reach run unaccelerated, so nothing that resolves
    // within the window can observe this.
    const input = pass < EXACT_PASSES ? decoded : flattenNesting(decoded);
    let next: string;
    try {
      next = decodePreservingSeparators(input);
    } catch {
      return input;
    }
    if (next === input) {
      return input;
    }
    decoded = next;
  }
  return decoded;
}

// Passes that run exactly as they always have — one `%25` level per pass, no
// acceleration. It covers every depth a decoding consumer can actually resolve
// (a proxy decodes, a backend decodes again, and five more), so any path whose
// decoding converges — or aborts on a malformed escape — within the window is
// byte-identical to the unbounded loop, abort semantics included. Past it the
// depth is no longer information a consumer can act on, only passes to burn.
const EXACT_PASSES = 8;

// Absolute ceiling on the loop, so the work is O(n) whatever the input. Past
// `EXACT_PASSES` every pass first collapses all `%25` nesting, leaving only one
// construction that still needs another pass — an escape whose own hex digits
// are escaped (`%25%32%66` → `%2f`), which triples in length per level, so the
// passes here are logarithmic in the path length: the deepest such chain a 1 MB
// path can carry needs 13. Reaching the ceiling would return the most decoded
// reading found so far, the same partial-reading contract a malformed escape
// already has.
const MAX_PASSES = 24;

// `hasDecodableEscape`/`flattenNesting` (end of file) each need one fact about
// the pass they bracket: `%2f`/`%5c` at any `%25` nesting depth are held back at
// *every* pass, so such a chain is already at its fixpoint
// (`decodePreservingSeparators`). It is the only upstream detail duplicated
// here; getting it wrong can only cost a pass or leave a separator chain
// untouched, never decode one into a real separator.
const CHAR_2 = 50;
const CHAR_5 = 53;

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
 *
 * The {@link decodedPath} reading is checked too, so the base has to hold for a
 * downstream that percent-decodes before resolving — which also covers the one
 * traversal `resolveDotSegments` documents as out of reach on its own, a dot
 * whose *hex digits* are themselves encoded (`%25%32%65` → `%2e` → `.`). For an
 * h3 request that spelling now arrives already canonicalized to `%252e`, which
 * `resolveDotSegments` collapses on its own; this keeps the check sound for a
 * non-h3 caller and for the deeper nestings canonicalization leaves intact.
 */
export function isPathInScope(pathname: string, base: string): boolean {
  if (!base) {
    return true;
  }
  if (!isEveryCanonicalReadingInScope(pathname, base)) {
    return false;
  }
  const decoded = decodedPath(pathname);
  return decoded === pathname || isEveryCanonicalReadingInScope(decoded, base);
}

// Both canonical readings (empty-segment-preserving and slash-merged) of one
// spelling of the path.
function isEveryCanonicalReadingInScope(pathname: string, base: string): boolean {
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

/**
 * Whether decoding `value` can still change it — i.e. it carries a `%` that is
 * not a nested separator. `false` is exact and means the next pass would return
 * `value` unchanged, so the loop can stop one pass early: every `%` is then
 * inside a separator match, which is re-emitted verbatim, and the gaps between
 * those matches have no `%` left for `decodeURIComponent` to act on.
 *
 * Only the maximal `25` run has to be checked per `%`: a shorter one is
 * followed by `25`, which is neither `2f` nor `5c`.
 */
function hasDecodableEscape(value: string): boolean {
  for (let i = value.indexOf("%"); i !== -1; i = value.indexOf("%", i + 1)) {
    const byte = escapeByte(value, nestingEnd(value, i));
    if (byte !== 0x2f && byte !== 0x5c) {
      return true;
    }
  }
  return false;
}

/**
 * Collapse every `%25` nesting chain to the level it would reach after the
 * unwrapping passes, in a single scan — `%25252540` → `%40`, the same string
 * the third pass produces.
 *
 * A chain unwrapping onto something that is not an escape body (`%2525zz`, or
 * the end of the string) keeps one level, so the bare `%` that aborts the pass
 * still appears exactly one pass later, as it does unaccelerated. A separator
 * chain is left alone — it is at its fixpoint at every depth.
 */
function flattenNesting(path: string): string {
  let flat = "";
  let last = 0;
  for (let i = path.indexOf("%"); i !== -1; i = path.indexOf("%", i + 1)) {
    const end = nestingEnd(path, i);
    if (end === i + 1) {
      continue; // not a nesting chain
    }
    const byte = escapeByte(path, end);
    if (byte === 0x2f || byte === 0x5c) {
      continue; // separator chain: already at its fixpoint, at every depth
    }
    flat += path.slice(last, i) + (byte === -1 ? "%25" : "%");
    last = end;
  }
  return last === 0 ? path : flat + path.slice(last);
}

/** Index just past the run of `25` pairs following the `%` at `index`. */
function nestingEnd(value: string, index: number): number {
  let end = index + 1;
  while (value.charCodeAt(end) === CHAR_2 && value.charCodeAt(end + 1) === CHAR_5) {
    end += 2;
  }
  return end;
}

/** The byte two hex digits at `index` stand for, or `-1` if they are not two. */
function escapeByte(value: string, index: number): number {
  const high = hexDigit(value.charCodeAt(index));
  const low = hexDigit(value.charCodeAt(index + 1));
  return high === -1 || low === -1 ? -1 : high * 16 + low;
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48; // 0-9
  }
  if (code >= 97 && code <= 102) {
    return code - 87; // a-f
  }
  if (code >= 65 && code <= 70) {
    return code - 55; // A-F
  }
  return -1;
}
