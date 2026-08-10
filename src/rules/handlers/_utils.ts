import { HTTPError } from "../../error.ts";
import type { H3Event } from "../../event.ts";
import { getURLPathname, joinURL, withoutBase } from "../../utils/internal/path.ts";
import { isPathInScope } from "../internal/scope.ts";
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
    // Target's own base path (`to` minus `/**`), used to scope-check the final forwarded target below.
    let baseTargetPath = getURLPathname(baseTarget);
    if (baseTargetPath.endsWith("/")) {
      baseTargetPath = baseTargetPath.slice(0, -1);
    }
    return (event) => {
      let targetPath = event.url.pathname + event.url.search;
      if (base) {
        // Fail closed if the raw path doesn't literally sit under `base` (e.g. an
        // encoded separator or dot-segment makes it canonical-only under base) —
        // it can't be faithfully stripped, so don't forward it unstripped.
        const rawPath = event.url.pathname;
        if (
          !isPathInScope(rawPath, base) ||
          !(rawPath === base || rawPath.startsWith(base + "/"))
        ) {
          throw new HTTPError({ status: 400 });
        }
        targetPath = withoutBase(targetPath, base);
      } else {
        // Only the leading position can leak as a protocol-relative `//host` URL;
        // interior separators stay opaque and are forwarded verbatim.
        targetPath = targetPath.replace(LEADING_SEPARATOR_RUN_RE, "/");
      }
      const resolved = joinURL(baseTarget, targetPath);
      // Re-check scope on the final joined target, not just the incoming path:
      // joinURL collapses empty segments that may have shielded a `..` pre-join,
      // so a `..%2f` can still escape the target's own base post-join.
      if (!isPathInScope(getURLPathname(resolved), baseTargetPath)) {
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
