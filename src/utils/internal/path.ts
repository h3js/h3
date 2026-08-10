export function withoutTrailingSlash(path: string | undefined): string {
  if (!path || path === "/") {
    return "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  return path[path.length - 1] === "/" ? path.slice(0, -1) : path;
}

/** Prefix `path` with a slash unless it already has one (`""` → `"/"`). */
export function withLeadingSlash(path: string | undefined): string {
  return !path ? "/" : path[0] === "/" ? path : "/" + path;
}

/**
 * Join `base` and `path` on a single `/` boundary.
 *
 * Semantics match `ufo`'s two-argument `joinURL` exactly (route rules rely on
 * it for `redirect`/`proxy` wildcard targets, where the joined value is then
 * re-scope-checked): an empty/`"/"` `path` yields `base` untouched, a single
 * leading `/` (or `./`) on `path` is absorbed by the boundary while a longer
 * separator run is preserved, and a falsy `base` yields `path` — or `""` when
 * there is nothing to join at all.
 */
export function joinURL(base: string | undefined, path: string | undefined): string {
  if (!path || path === "/") {
    return base || "";
  }
  if (!base) {
    return path;
  }
  // Only the boundary separator is absorbed: `//evil.com` keeps its extra
  // slash so a caller's scope check still sees the empty segment.
  const segment = path.replace(JOIN_LEADING_SLASH_RE, "");
  // eslint-disable-next-line unicorn/prefer-at
  return (base[base.length - 1] === "/" ? base : base + "/") + segment;
}

const JOIN_LEADING_SLASH_RE = /^\.?\//;

/**
 * Strip `base` from `pathname` when it matches on a segment boundary, collapsing
 * the leading-slash run so `/base//evil.com` can never strip to a protocol-relative
 * `//evil.com` a downstream redirect could turn into an open redirect.
 *
 * A `?` also counts as a boundary (`ufo` parity), so callers may pass
 * `pathname + search` — `/base?q=1` with base `/base` strips to `/?q=1` instead
 * of silently staying unstripped. For a bare pathname this is unreachable.
 *
 * `base` must not have a trailing slash; use {@link withoutBase} to tolerate one.
 */
export function stripBase(pathname: string, base: string): string {
  if (pathname === base || pathname.startsWith(base + "/") || pathname.startsWith(base + "?")) {
    return "/" + pathname.slice(base.length).replace(/^\/+/, "");
  }
  return pathname;
}

/** Like {@link stripBase}, but tolerates a trailing slash in `base`. */
export function withoutBase(input: string = "", base: string = ""): string {
  if (!base || base === "/") {
    return input;
  }
  return stripBase(input, withoutTrailingSlash(base));
}

export function getPathname(path: string = "/"): string {
  return path.startsWith("/") ? path.split("?")[0] : new URL(path, "http://localhost").pathname;
}

// NUL is part of ufo's own character classes (it treats a `\0` as leading
// whitespace / a scheme character, so a NUL-smuggled URL parses the same way
// there and here) — matching it is the point.
// Non-strict protocol test (`ufo`'s `hasProtocol`): a scheme, optionally
// followed by `//`, or a protocol-relative `//host` prefix.
// eslint-disable-next-line no-control-regex
const PROTOCOL_RE = /^[\s\w\u0000+.-]{2,}:([/\\]{2})?/;
const PROTOCOL_RELATIVE_RE = /^([/\\]\s*){2,}[^/\\]/;
// Opaque schemes whose whole remainder is the "pathname".
// eslint-disable-next-line no-control-regex
const SPECIAL_PROTOCOL_RE = /^[\s\u0000]*(?:blob:|data:|javascript:|vbscript:)(.*)/i;
// scheme + `//` + optional userinfo, leaving `host[/path][?query][#hash]`.
// eslint-disable-next-line no-control-regex
const AUTHORITY_RE = /^[\s\u0000]*([\w+.-]{2,}:)?\/\/(?:[^/@]+@)?(.*)/;
const HOST_AND_PATH_RE = /([^#/?]*)(.*)?/;
const FILE_DRIVE_RE = /\/(?=[A-Za-z]:)/;

/**
 * The pathname of an absolute, protocol-relative, or relative URL/path —
 * everything after the authority (if any) and before `?`/`#`.
 *
 * Purely lexical, matching `ufo`'s `parseURL(input).pathname`: unlike
 * {@link getPathname} it never routes through `new URL()`, which would
 * *normalize dot segments* (`/base//../secret` → `/base/secret`) and thereby
 * defeat a scope check meant to catch exactly that escape, and would also read
 * a protocol-relative `//host/p` as the pathname `//host/p`. Percent-encoding
 * is likewise left untouched, so an opaque `%2f` stays opaque for the caller's
 * own canonicalization passes.
 */
export function getURLPathname(input: string): string {
  const special = SPECIAL_PROTOCOL_RE.exec(input);
  if (special) {
    return special[1]!;
  }
  if (!PROTOCOL_RE.test(input) && !PROTOCOL_RELATIVE_RE.test(input)) {
    return splitPathname(input);
  }
  // A scheme without `//` (e.g. `mailto:x`) has no authority to split off and
  // no pathname in this model — the match fails and yields "".
  const authority = AUTHORITY_RE.exec(input.replace(/\\/g, "/"));
  let path = HOST_AND_PATH_RE.exec(authority?.[2] ?? "")?.[2] ?? "";
  if (authority?.[1]?.toLowerCase() === "file:") {
    // `file:///C:/x` addresses drive `C:`, not a root-level `/C:` directory.
    path = path.replace(FILE_DRIVE_RE, "");
  }
  return splitPathname(path);
}

function splitPathname(path: string): string {
  const end = path.search(/[#?]/);
  return end === -1 ? path : path.slice(0, end);
}

/**
 * Decode percent-encoded pathname, preserving %25 (literal `%`).
 */
export function decodePathname(pathname: string): string {
  return decodeURI(pathname.includes("%25") ? pathname.replace(/%25/g, "%2525") : pathname);
}
