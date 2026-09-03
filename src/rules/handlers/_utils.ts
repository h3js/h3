import { HTTPError } from "../../error.ts";
import type { H3Event } from "../../event.ts";
import { getURLPathname, joinURL, withoutBase } from "../../utils/internal/path.ts";
import { decodedPath, isPathInScope } from "../internal/scope.ts";
import type { ProxyRuleOptions, RedirectRuleOptions } from "../types.ts";
import { interpolateSplat, parseSplatTemplate } from "./_splat.ts";

/**
 * Per-request resolver for a `redirect`/`proxy` rule target, produced once per
 * handler by {@link prepareRuleTarget}.
 */
export type RuleTargetResolver = (event: H3Event) => string;

/**
 * Per-request resolver for the tail a `/**` rule key matched: the request path
 * with the rule's own base stripped, always `/`-prefixed. Throws 400 when the
 * path cannot be faithfully stripped (see {@link prepareTailResolver}).
 */
type TailResolver = (event: H3Event) => string;

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

// A prefix segment matching a variable number of path segments: a catch-all
// (`**`, `**:rest`) or a modifier param (`:x?` 0-1, `:x*` 0-n, `:x+` 1-n).
const VARIABLE_WIDTH_SEGMENT_RE = /^\*\*|^:.*[?*+]$/;

/**
 * Prepare a redirect or proxy target resolver. Wildcard tails and query strings
 * are forwarded while canonical scope checks prevent traversal.
 */
export function prepareRuleTarget(
  options: RedirectRuleOptions | ProxyRuleOptions | undefined,
): RuleTargetResolver | undefined {
  const target = options?.to;
  if (!target) {
    return;
  }
  const base = options?.base;

  if (target.endsWith("/**")) {
    const baseTarget = target.slice(0, -3);
    // Target's own base path (`to` minus `/**`), used to scope-check the final forwarded target below.
    const baseTargetPath = targetBasePath(baseTarget);
    const resolveTail = prepareTailResolver(base);
    return (event) => {
      // The query rides along with the tail: `stripBase` treats `?` as a segment
      // boundary, so `GET /old?q=1` under base `/old` joins as `/new/?q=1`.
      const resolved = joinURL(baseTarget, resolveTail(event) + event.url.search);
      assertTargetInScope(resolved, baseTargetPath);
      return resolved;
    };
  }

  // A `**` anywhere else in the target — a query value (`/new?from=**`), a
  // mid-path segment (`/new/**/edit`) — interpolates the same matched tail
  // through the same scope checks. Only a rule key ending in `/**` has a tail
  // to capture, and `base` is set exactly then; without one the `**` is left
  // literal, as it always has been.
  const template = base === undefined ? undefined : parseSplatTemplate(target);
  if (template) {
    // Everything ahead of the first placeholder is config-authored text: it
    // fixes the target's own base path, and its origin.
    const prefix = template.literals[0]!;
    const baseTargetPath = targetBasePath(prefix);
    const resolveTail = prepareTailResolver(base);
    return (event) => {
      // Drop the tail's leading `/`: a path placeholder is written with its own
      // separator (`/new/**/edit`), and a value placeholder wants none at all.
      const resolved = interpolateSplat(template, resolveTail(event).slice(1));
      assertTargetInScope(resolved, baseTargetPath);
      assertTargetOrigin(resolved, prefix, event.url);
      return appendSearch(resolved, event.url.search);
    };
  }

  return (event) => appendSearch(target, event.url.search);
}

/**
 * Resolver for the request tail under `base`, the rule key minus its `/**`.
 *
 * `base` is *pattern* text, so it may carry rou3 dynamic segments that can
 * never equal a request path literally; those are stripped by segment count
 * instead. Anything that cannot be stripped faithfully throws 400 rather than
 * forwarding a mis-stripped path.
 */
function prepareTailResolver(base: string | undefined): TailResolver {
  // Segment count of a dynamic pattern prefix (0 = use `base` literally).
  const baseSegments = base && DYNAMIC_PATTERN_RE.test(base) ? patternSegmentCount(base) : 0;
  return (event) => {
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
    if (!scopeBase) {
      // Only the leading position can leak as a protocol-relative `//host` URL;
      // interior separators stay opaque and are forwarded verbatim.
      return rawPath.replace(LEADING_SEPARATOR_RUN_RE, "/");
    }
    // Fail closed if the raw path doesn't literally sit under `scopeBase` (e.g. an
    // encoded separator or dot-segment makes it canonical-only under base) —
    // it can't be faithfully stripped, so don't forward it unstripped.
    // A derived base satisfies the literal test by construction; `isPathInScope`
    // carries the weight there, rejecting a path whose canonical readings
    // disagree with the raw segments the base was taken from.
    if (!isLiterallyInScope(rawPath, scopeBase)) {
      // The rule can also have matched through the matcher's *decoded*
      // reading — a pattern spelled `/a b/**` covers a `/a%20b/...`
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
    return withoutBase(rawPath, scopeBase);
  };
}

/** A target's own base path: its pathname, without a trailing slash. */
function targetBasePath(prefix: string): string {
  const path = getURLPathname(prefix);
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Append the request's query to `target`, ahead of any `#fragment`. */
function appendSearch(target: string, search: string): string {
  if (!search) {
    return target;
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
  return targetBase + joiner + search.slice(1) + targetHash;
}

/**
 * Re-check scope on the final resolved target, not just the incoming path:
 * `joinURL` collapses empty segments that may have shielded a `..` pre-join, so
 * a `..%2f` can still escape the target's own base post-join — and an
 * interpolated tail lands inside the target rather than after it.
 */
function assertTargetInScope(resolved: string, baseTargetPath: string): void {
  if (!isFinalTargetInScope(getURLPathname(resolved), baseTargetPath)) {
    throw new HTTPError({ status: 400 });
  }
}

/**
 * Reject a resolved target whose origin is not the one the template's own
 * literal prefix resolves to.
 *
 * A trailing `to: ".../**"` appends strictly after the target's path, so the
 * tail can never reach the destination host. An interpolated placeholder
 * splices *into* the target, where the tail can carry a `scheme:` or a `//`,
 * and where an empty tail can collapse two literal separators into a
 * protocol-relative `//host`. Neither is visible to {@link isFinalTargetInScope},
 * which is handed a pathname the authority has already been parsed out of.
 *
 * This asks the URL parser rather than re-deriving the authority lexically:
 * the two disagree in enough spellings (`http:///h`, `https:/h`, `/\h`, all of
 * which a browser reads as host `h`) that a lexical check is the wrong tool.
 * A reading that does not parse at all fails closed.
 */
function assertTargetOrigin(resolved: string, prefix: string, url: URL): void {
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(prefix, url);
    actual = new URL(resolved, url);
  } catch {
    throw new HTTPError({ status: 400 });
  }
  // `origin` is `"null"` for every non-special scheme, so compare the protocol
  // too — `mailto:`, `javascript:` and friends must not swap for one another.
  if (expected.origin !== actual.origin || expected.protocol !== actual.protocol) {
    throw new HTTPError({ status: 400 });
  }
}

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

/**
 * Number of path segments a rule pattern prefix matches (`/:lang/old` → 2), or
 * 0 when it has no fixed count.
 *
 * Only a prefix whose every segment matches exactly one path segment can be
 * stripped by count. A catch-all or modifier param (`/:lang?/old`, or a
 * `:seg*` segment mid-prefix) matches a varying number, and so does a group
 * spanning a separator (`/x{/a}?/old`) — splitting it here leaves its braces
 * unbalanced.
 * Counting any of those strips the wrong number of segments off the request
 * path, so they return 0 and fall through to the literal comparison, which
 * rejects (400) instead of forwarding a silently mis-stripped path.
 */
function patternSegmentCount(base: string): number {
  const segments = splitSegments(base);
  let depth = 0;
  for (const segment of segments) {
    if (VARIABLE_WIDTH_SEGMENT_RE.test(segment)) {
      return 0;
    }
    for (let i = 0; i < segment.length; i++) {
      if (segment[i] === "{") {
        depth++;
      } else if (segment[i] === "}") {
        depth--;
      }
    }
    if (depth !== 0) {
      return 0;
    }
  }
  return segments.length;
}

/** Number of `/`-delimited segments in a concrete path (`/a/b` → 2). */
function countSegments(base: string): number {
  return splitSegments(base).length;
}

// A prefix without a leading `/` still routes as if it had one (rou3 coerces
// it), so its first segment would otherwise go uncounted.
function splitSegments(base: string): string[] {
  return (base.startsWith("/") ? base.slice(1) : base).split("/");
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
