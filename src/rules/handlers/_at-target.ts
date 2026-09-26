import type { H3Event } from "../../event.ts";
import { getURLPathname } from "../../utils/internal/path.ts";
import { isPathInScope } from "../internal/scope.ts";
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
 * - `"/new"` (nothing interpolated): the path is exactly `/new`.
 *
 * Only the target's path is compared, never its query or fragment. A target on
 * another origin (or a relative reference that has no fixed path) is never
 * skipped, and neither is one whose shape covers every path (`"/**"`): skipping
 * would disable the rule outright.
 *
 * Skipping is fail-safe: a wildcard shape is honoured only when every canonical
 * reading of the path stays inside the target's own directory, so an encoded
 * traversal (`/docs/v2/..%2fadmin`) is never let through to the app — it still
 * reaches the rule, whose target scope check answers `400` as before.
 */
export function prepareAtTargetCheck(
  options: RedirectRuleOptions | undefined,
): AtTargetCheck | undefined {
  const target = options?.to;
  if (!target) {
    return;
  }
  const origin = targetOrigin(target);
  if (origin === undefined) {
    return;
  }
  const isAtPath = prepareTargetPathCheck(getURLPathname(target) || "/", target, options.base);
  if (!isAtPath) {
    return;
  }
  return origin
    ? (event) => event.url.origin === origin && isAtPath(event.url.pathname)
    : (event) => isAtPath(event.url.pathname);
}

/**
 * The origin an absolute `target` names, `""` for a path-absolute target
 * (`/new`, always same-origin), or `undefined` when its origin is unknowable
 * ahead of the request (protocol-relative `//host`, relative `new`, a
 * non-special scheme).
 */
function targetOrigin(target: string): string | undefined {
  if (target.startsWith("/")) {
    return target[1] === "/" || target[1] === "\\" ? undefined : "";
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return;
  }
  return url.origin === "null" ? undefined : url.origin;
}

/**
 * Matcher for the target's path shape, mirroring which `**` placeholders
 * `prepareRuleTarget` interpolates: a trailing `/**` always, any other `**` only
 * when the rule has a matched tail (`base` is set).
 */
function prepareTargetPathCheck(
  path: string,
  target: string,
  base: string | undefined,
): ((pathname: string) => boolean) | undefined {
  if (target.endsWith("/**")) {
    // `/docs/v2/**` → `/docs/v2`; the empty tail joins to the bare base itself.
    const prefix = path.slice(0, -3);
    if (!prefix) {
      return;
    }
    return (pathname) =>
      (pathname === prefix || pathname.startsWith(prefix + "/")) && isPathInScope(pathname, prefix);
  }
  const first = base === undefined ? -1 : path.indexOf("**");
  if (first === -1) {
    return (pathname) => pathname === path;
  }
  const prefix = path.slice(0, first);
  const suffix = path.slice(path.lastIndexOf("**") + 2);
  if (prefix.length <= 1 && !suffix) {
    return;
  }
  // The directory the prefix fixes (`/blog/` → `/blog`, `/docs/v` → `/docs`).
  const scope = prefix.slice(0, prefix.lastIndexOf("/"));
  const minLength = prefix.length + suffix.length;
  return (pathname) =>
    pathname.length >= minLength &&
    pathname.startsWith(prefix) &&
    pathname.endsWith(suffix) &&
    isPathInScope(pathname, scope);
}
