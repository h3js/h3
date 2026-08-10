export function withoutTrailingSlash(path: string | undefined): string {
  if (!path || path === "/") {
    return "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  return path[path.length - 1] === "/" ? path.slice(0, -1) : path;
}

export function joinURL(base: string | undefined, path: string | undefined): string {
  if (!base || base === "/") {
    return path || "/";
  }
  if (!path || path === "/") {
    return base || "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  const baseHasTrailing = base[base.length - 1] === "/";
  const pathHasLeading = path[0] === "/";
  if (baseHasTrailing && pathHasLeading) {
    return base + path.slice(1);
  }
  if (!baseHasTrailing && !pathHasLeading) {
    return base + "/" + path;
  }
  return base + path;
}

/**
 * Strip `base` from `pathname` when it matches on a segment boundary, collapsing
 * the leading-slash run so `/base//evil.com` can never strip to a protocol-relative
 * `//evil.com` a downstream redirect could turn into an open redirect.
 *
 * `base` must not have a trailing slash; use {@link withoutBase} to tolerate one.
 */
export function stripBase(pathname: string, base: string): string {
  if (pathname === base || pathname.startsWith(base + "/")) {
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

// Percent-escapes of *unreserved* characters (RFC 3986 §2.3: ALPHA / DIGIT / `-`
// / `.` / `_` / `~`). Encoding them is never necessary, and §6.2.2.2 makes the
// encoded and decoded forms equivalent — so anything that decodes downstream (a
// proxy, a filesystem, a handler calling `decodeURIComponent`) resolves
// `/%61dmin` and `/admin` to the same resource, while h3's matchers compare them
// as two different strings. That gap is the middleware-bypass vector, so such a
// path is decoded to its canonical form before anything can match on it, rather
// than being dispatched under a name a guard would not recognize.
//
// Every other escape is deliberately left alone: `%2F`/`%5C` are structural (a
// `:param` must never gain a separator the router did not match on), and `%20`,
// `%25`, `%09`, non-ASCII and friends decode to bytes that cannot make one
// segment read as a different segment.
const UNRESERVED_ESCAPE_SRC = String.raw`%(?:2[DE]|3[0-9]|4[1-9A-F]|5[0-9AF]|6[1-9A-F]|7[0-9AE])`;
const UNRESERVED_ESCAPE_RE = /* @__PURE__ */ new RegExp(UNRESERVED_ESCAPE_SRC, "i");
const UNRESERVED_ESCAPE_RE_G = /* @__PURE__ */ new RegExp(UNRESERVED_ESCAPE_SRC, "gi");

/**
 * Whether `pathname` is *not* in canonical form, i.e. it percent-encodes an
 * unreserved character and therefore names a resource that a decoding consumer
 * reads under a different path than the one h3 matched routes and middleware on.
 *
 * A single scan, no allocation — this runs on every request whose path contains
 * a `%`, and returns `false` for the common encodings (`%20`, `%2F`, non-ASCII).
 */
export function isNonCanonicalPathname(pathname: string): boolean {
  return UNRESERVED_ESCAPE_RE.test(pathname);
}

/**
 * Canonical form of `pathname`: unreserved escapes decoded, everything else left
 * byte-for-byte as it arrived.
 *
 * Idempotent by construction — no unreserved escape is left to decode — so the
 * result is a fixed point and re-canonicalizing it is a no-op. Dot segments need
 * no handling here: the URL parser resolves them (including every `%2e` spelling,
 * per WHATWG "double-dot path segment") before the pathname reaches h3, and
 * decoding an unreserved escape introduces no new segment boundary that could
 * reveal one. Assigning the result back through a URL `pathname` setter re-runs
 * that resolution anyway.
 */
export function canonicalPathname(pathname: string): string {
  return pathname.replace(UNRESERVED_ESCAPE_RE_G, (m) =>
    String.fromCharCode(Number.parseInt(m.slice(1), 16)),
  );
}

/**
 * Whether `pathname` contains malformed percent-encoding — a truncated escape
 * (`/foo%`, `/bar%2`), a non-hex one (`/%ZZ`) or an invalid UTF-8 sequence
 * (`/%80`). Such a path has no canonical form to decode to.
 */
export function isMalformedPathname(pathname: string): boolean {
  try {
    decodeURI(pathname);
    return false;
  } catch {
    return true;
  }
}
