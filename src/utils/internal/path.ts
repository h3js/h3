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
 * Route rules join `redirect`/`proxy` wildcard targets with this and then
 * re-scope-check the result, so the contract is: an empty/`"/"` `path` yields
 * `base` untouched, a single leading `/` on `path` is absorbed by the boundary
 * while a longer separator run is preserved, and a falsy `base` yields `path`.
 *
 * The result is never empty — an empty `Location` is a URI-reference that
 * resolves back to the request URL, which turns a wildcard redirect onto `/`
 * into a redirect loop.
 */
export function joinURL(base: string | undefined, path: string | undefined): string {
  if (!path || path === "/") {
    return base || "/";
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
 * A `?` also counts as a boundary, because the rules `/**` target resolver
 * passes `pathname + search`: without it, `GET /old?q=1` under base `/old`
 * resolves to `/new/old?q=1` instead of `/new/?q=1`. A WHATWG `pathname` can
 * never contain a literal `?`, so this is unreachable for h3's core callers.
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

// `scheme://` or a protocol-relative `//`; whatever follows, up to the next
// `/`, `?` or `#`, is the authority. Scheme syntax per RFC 3986 §3.1.
const AUTHORITY_RE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

/**
 * The pathname of an absolute, protocol-relative, or relative URL/path —
 * everything after the authority (if any) and before `?`/`#`.
 *
 * Purely lexical, never `new URL()`: the result is scope-checked against the
 * *exact bytes* that get forwarded, so nothing may be normalized away first.
 * `new URL()` would resolve dot segments (`/base//../secret` → `/base/secret`),
 * collapsing the empty segment that the rules scope check's slash-merged
 * reading needs in order to see the escape, and would re-encode characters the
 * target string keeps verbatim. Percent-encoding is likewise left untouched, so
 * an opaque `%2f` stays opaque for the caller's own canonicalization passes.
 */
export function getURLPathname(input: string): string {
  const path = AUTHORITY_RE.test(input)
    ? input.replace(AUTHORITY_RE, "").replace(/^[^/?#]*/, "")
    : input;
  const end = path.search(/[#?]/);
  return end === -1 ? path : path.slice(0, end);
}

/**
 * Decode percent-encoded pathname, preserving %25 (literal `%`).
 */
export function decodePathname(pathname: string): string {
  return decodeURI(pathname.includes("%25") ? pathname.replace(/%25/g, "%2525") : pathname);
}
