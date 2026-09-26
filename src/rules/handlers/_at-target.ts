import type { H3Event } from "../../event.ts";
import { getURLPathname } from "../../utils/internal/path.ts";
import { isPathInServedScope } from "../internal/scope.ts";
import type { RedirectRuleOptions } from "../types.ts";

/**
 * Per-request check for whether the request is already at a URL a `redirect`
 * rule could have sent it to, produced once per handler by
 * {@link prepareAtTargetCheck}.
 */
export type AtTargetCheck = (event: H3Event) => boolean;

/**
 * Prepare the "already at the target" guard for a `redirect` rule, or
 * `undefined` when the rule can never be skipped.
 *
 * A target that falls inside its own rule's pattern (`"/docs/**"` →
 * `"/docs/v2/**"`) would otherwise redirect again from the URL it just sent the
 * client to. The guard compares the request path with the *shape* of the
 * target path — its literal text around the `**` placeholders — so the rule
 * stands down wherever it could only produce a URL of that same shape:
 *
 * - `"/docs/v2/**"`: the path is `/docs/v2` or sits under `/docs/v2/`.
 * - `"/blog/**.md"`: the path starts with `/blog/` and ends in `.md`, at any depth.
 * - `"/new"`, `"/new?from=/**"` (no `**` in the path): the path is exactly `/new`.
 *
 * Only the target's path is compared, never its query or fragment. Only a
 * path-absolute target (`/…`) is ever skipped: an absolute URL's origin could
 * only be compared with the request's `Host`, which the client controls. A
 * shape that covers every path (`"/**"`) is never skipped either — skipping
 * would disable the rule outright.
 *
 * Skipping is fail-safe: a wildcard shape is honoured only when its prefix ends
 * on a segment boundary and every canonical reading of the path stays inside
 * it, so an encoded traversal (`/docs/v2/..%2fadmin`) is never let through to
 * the app — it still reaches the rule, whose target scope check answers `400`.
 */
export function prepareAtTargetCheck(
  options: RedirectRuleOptions | undefined,
): AtTargetCheck | undefined {
  const target = options?.to;
  // A protocol-relative `//host` (or `/\host`) names another origin.
  if (!target?.startsWith("/") || target[1] === "/" || target[1] === "\\") {
    return;
  }
  const isAtPath = prepareTargetPathCheck(
    getURLPathname(target),
    options!.base,
    target.endsWith("/**"),
  );
  return isAtPath && ((event) => isAtPath(event.url.pathname));
}

/**
 * Matcher for the target's path shape, mirroring which `**` placeholders
 * `prepareRuleTarget` interpolates: a `to` ending in `/**` always, any other
 * `**` only when the rule has a matched tail (`base` is set). Without a tail, a
 * path `/**` followed by a query or fragment (`/new/**?x=1`) stays literal.
 */
function prepareTargetPathCheck(
  path: string,
  base: string | undefined,
  appendsTail: boolean,
): ((pathname: string) => boolean) | undefined {
  if (path.endsWith("/**") && (appendsTail || base !== undefined)) {
    // `/docs/v2/**` → `/docs/v2`; the empty tail joins to the bare base itself.
    const prefix = servedPath(path.slice(0, -3));
    if (!prefix) {
      return;
    }
    return (pathname) =>
      (pathname === prefix || pathname.startsWith(prefix + "/")) &&
      isPathInServedScope(pathname, prefix);
  }
  const first = base === undefined ? -1 : path.indexOf("**");
  if (first === -1) {
    const exact = servedPath(path);
    return (pathname) => pathname === exact;
  }
  const rawPrefix = path.slice(0, first);
  // A mid-segment placeholder (`/docs/v2-**`) could be skipped by raw bytes a
  // decoding reading moves out of its segment; never skip one.
  if (!rawPrefix.endsWith("/")) {
    return;
  }
  const prefix = servedPath(rawPrefix);
  const suffix = servedPath("/" + path.slice(path.lastIndexOf("**") + 2)).slice(1);
  if (prefix === "/" && !suffix) {
    return;
  }
  const scope = prefix.slice(0, -1);
  const minLength = prefix.length + suffix.length;
  return (pathname) =>
    pathname.length >= minLength &&
    pathname.startsWith(prefix) &&
    pathname.endsWith(suffix) &&
    isPathInServedScope(pathname, scope);
}

/**
 * `path` spelled the way `event.url.pathname` serves it (`/café` →
 * `/caf%C3%A9`), so a literal target compares equal to a request for it.
 * Appended to a fixed origin rather than resolved against one, so a leading
 * `//` stays a path instead of parsing as an authority.
 */
function servedPath(path: string): string {
  return path && new URL("http://h" + path).pathname;
}
