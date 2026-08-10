import { HTTPError } from "../../error.ts";
import type { H3Event } from "../../event.ts";
import { getURLPathname, joinURL, withoutBase } from "../../utils/internal/path.ts";
import { decodedPath, isPathInScope } from "../internal/scope.ts";
import type { ProxyRuleOptions, RedirectRuleOptions } from "../types.ts";

/**
 * Per-request resolver for a `redirect`/`proxy` rule target, produced once per
 * handler by {@link prepareRuleTarget}.
 */
export type RuleTargetResolver = (event: H3Event) => string;

// Matches a leading run of path separators, in every form h3's
// `resolveDotSegments` decodes to `/` — collapsed so a base-less wildcard
// target can't be read downstream as a protocol-relative `//host` URL.
const LEADING_SEPARATOR_RUN_RE = /^(?:[/\\]|%(?:25)*(?:2f|5c))+/i;

// Any rou3 pattern syntax that can make a prefix segment dynamic: `:param`,
// `*`, and the regex/partial/escaped forms (`(`, `\`). Deliberately over-broad
// — a segment wrongly treated as dynamic still resolves to the request's own
// (literally matched) segment; only the stricter literal-prefix comparison is
// traded away.
const DYNAMIC_PATTERN_RE = /[:*()\\]/;

// A `**` segment inside the prefix has no fixed segment count, so no effective
// base can be derived from it. Left to the literal comparison below, which
// rejects (400) — the same outcome as before, never a silent wrong strip.
const UNCOUNTABLE_PATTERN_RE = /(?:^|\/)\*\*/;

/**
 * Prepare the target resolver for a `redirect`/`proxy` rule, or `undefined`
 * when the rule has no target. Static `to`/`base`-derived work happens once
 * per handler closure; the returned resolver does only the request-dependent
 * part (scope checks, query forwarding).
 *
 * For `/**` wildcard targets, the resolver forwards `event.url.pathname`
 * exactly as h3 served it (an encoded `%2f` stays opaque — like nginx
 * `proxy_pass $request_uri`), and the scope check canonicalizes to reject
 * traversal that only surfaces once a downstream decodes that separator.
 *
 * `base` is the rule *key* minus `/**` (see {@link RedirectRuleOptions.base}),
 * i.e. **pattern text** — `/:lang/old` for `/:lang/old/**` — which no request
 * path can ever equal literally. rou3's `:param`/`*` (and regex/partial params)
 * each match exactly one segment, so for a dynamic prefix the effective base is
 * the matched path's own leading segments, taken by count at request time.
 * A fully static prefix keeps the literal string: faster, and a stricter check.
 *
 * For non-wildcard targets, the raw request query string is forwarded with
 * full fidelity (no URLSearchParams round-trip, which would collapse
 * duplicate keys and re-encode values); the target's own query params come
 * first, the request's are appended after.
 */
export function prepareRuleTarget(
  options: RedirectRuleOptions | ProxyRuleOptions | undefined,
): RuleTargetResolver | undefined {
  const target = options?.to;
  if (!target) {
    return;
  }

  if (target.endsWith("/**")) {
    const baseTarget = target.slice(0, -3);
    const base = options?.base;
    // Segment count of a dynamic pattern prefix (0 = use `base` literally).
    const baseSegments =
      base && DYNAMIC_PATTERN_RE.test(base) && !UNCOUNTABLE_PATTERN_RE.test(base)
        ? countSegments(base)
        : 0;
    // Target's own base path (`to` minus `/**`), used to scope-check the final forwarded target below.
    let baseTargetPath = getURLPathname(baseTarget);
    if (baseTargetPath.endsWith("/")) {
      baseTargetPath = baseTargetPath.slice(0, -1);
    }
    return (event) => {
      let targetPath = event.url.pathname + event.url.search;
      const rawPath = event.url.pathname;
      // Effective base for this request: the literal prefix, or the path's own
      // leading segments when the prefix is dynamic.
      let scopeBase = base;
      if (baseSegments) {
        scopeBase = leadingSegments(rawPath, baseSegments);
        if (scopeBase === undefined) {
          // Fewer segments than the pattern prefix (unreachable through rou3,
          // reachable through the matcher's canonical readings) — fail closed.
          throw new HTTPError({ status: 400 });
        }
      }
      if (scopeBase) {
        // Fail closed if the raw path doesn't literally sit under `scopeBase` (e.g. an
        // encoded separator or dot-segment makes it canonical-only under base) —
        // it can't be faithfully stripped, so don't forward it unstripped.
        // A derived base satisfies the literal test by construction; `isPathInScope`
        // carries the weight there, rejecting a path whose canonical readings
        // disagree with the raw segments the base was taken from.
        if (!isLiterallyInScope(rawPath, scopeBase)) {
          // The rule can also have matched through the matcher's *decoded*
          // reading — a pattern spelled `/@admin/**` covers a `/%40admin/...`
          // request — and there the raw path never literally starts with the
          // pattern prefix. Strip the request's own leading segments instead
          // (the by-count strip the dynamic-prefix branch already uses; decoding
          // never adds or removes a separator, so the counts line up), gated on
          // the decoded reading being in scope so a path that genuinely escapes
          // still fails closed. The forwarded remainder keeps its raw bytes.
          const decoded = decodedPath(rawPath);
          const derived =
            decoded === rawPath || !isLiterallyInScope(decoded, scopeBase)
              ? undefined
              : leadingSegments(rawPath, countSegments(scopeBase));
          if (derived === undefined) {
            throw new HTTPError({ status: 400 });
          }
          scopeBase = derived;
        }
        targetPath = withoutBase(targetPath, scopeBase);
      } else {
        // Only the leading position can leak as a protocol-relative `//host` URL;
        // interior separators stay opaque and are forwarded verbatim.
        targetPath = targetPath.replace(LEADING_SEPARATOR_RUN_RE, "/");
      }
      const resolved = joinURL(baseTarget, targetPath);
      // Re-check scope on the final joined target, not just the incoming path:
      // joinURL collapses empty segments that may have shielded a `..` pre-join,
      // so a `..%2f` can still escape the target's own base post-join.
      if (!isFinalTargetInScope(getURLPathname(resolved), baseTargetPath)) {
        throw new HTTPError({ status: 400 });
      }
      return resolved;
    };
  }

  // Split off any `#fragment` so appended query params land before it, not inside it.
  const hashIndex = target.indexOf("#");
  const targetBase = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const targetHash = hashIndex === -1 ? "" : target.slice(hashIndex);
  const joiner = targetBase.includes("?")
    ? targetBase.endsWith("?") || targetBase.endsWith("&")
      ? ""
      : "&"
    : "?";
  return (event) => {
    const search = event.url.search;
    if (!search) {
      return target;
    }
    return targetBase + joiner + search.slice(1) + targetHash;
  };
}

/**
 * Resolve the target URL for a `redirect`/`proxy` rule, or `undefined` when the
 * rule has no target. One-shot convenience over {@link prepareRuleTarget} —
 * rule handlers prepare once per closure instead.
 */
export function resolveRuleTarget(
  event: H3Event,
  options: RedirectRuleOptions | ProxyRuleOptions | undefined,
): string | undefined {
  return prepareRuleTarget(options)?.(event);
}

// ------------------------------------------------------------------------
// Internal
// ------------------------------------------------------------------------

/**
 * Scope check for the **final joined** target path against the target's own
 * base path — the root-aware counterpart of {@link isPathInScope}.
 *
 * With a base path, canonical containment is the whole story. Without one
 * (`to: "https://internal/**"`, or a bare `to: "/**"`, both of which yield an
 * empty pathname) the target is an origin root, and `isPathInScope(x, "")`
 * allows everything **by contract** — which would leave this re-check inert.
 * A root has exactly one escape: a leading separator *run*, which a
 * `%2f`-decoding downstream reads as an authority (`//evil.com`) rather than a
 * path. The base-less forwarding branch collapses such a run before joining,
 * but the `base` branch cannot — h3's `stripBase` collapses only *literal*
 * leading slashes, so `/old/%2f%2fevil.com` survives base stripping intact.
 * Reject it here instead of short-circuiting to allow.
 */
function isFinalTargetInScope(pathname: string, baseTargetPath: string): boolean {
  if (baseTargetPath) {
    return isPathInScope(pathname, baseTargetPath);
  }
  const run = LEADING_SEPARATOR_RUN_RE.exec(pathname);
  return run === null || run[0] === "/";
}

// Whether `pathname` sits under `base` under *every* reading (`isPathInScope`)
// **and** literally starts with it — the second half is what makes the base
// faithfully strippable from the bytes that get forwarded.
function isLiterallyInScope(pathname: string, base: string): boolean {
  return isPathInScope(pathname, base) && (pathname === base || pathname.startsWith(base + "/"));
}

/** Number of `/`-delimited segments in a rule pattern prefix (`/:lang/old` → 2). */
function countSegments(base: string): number {
  // A prefix without a leading `/` still routes as if it had one (rou3 coerces
  // it), so its first segment would otherwise go uncounted.
  let count = base.startsWith("/") ? 0 : 1;
  for (let i = 0; i < base.length; i++) {
    if (base[i] === "/") {
      count++;
    }
  }
  return count;
}

/** The first `count` segments of `pathname`, or `undefined` when it has fewer. */
function leadingSegments(pathname: string, count: number): string | undefined {
  let index = 0;
  for (let i = 0; i < count; i++) {
    index = pathname.indexOf("/", index + 1);
    if (index === -1) {
      // The last segment runs to the end of the path; anything short of that
      // means the path cannot cover the pattern prefix.
      return i === count - 1 ? pathname : undefined;
    }
  }
  return pathname.slice(0, index);
}
