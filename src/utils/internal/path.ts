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

// Percent-escapes that are *needless*: anything downstream that decodes the path
// (a proxy, a filesystem lookup, `serveStatic`'s own `decodeURI` peel, a handler
// calling `decodeURIComponent`) resolves the escape and its literal to the same
// resource, while h3's matchers compare them as two different strings. That gap
// is the middleware-bypass vector — `/%61dmin` reaching the `/admin` route past
// an `/admin` guard — so such a path is decoded to its canonical form before
// anything can match on it.
//
// The set is exactly the escapes `decodeURI` decodes whose character the WHATWG
// path serializer then keeps literal — i.e. the escapes the old decode-then
// -reparse pass visibly collapsed, so this stays byte-for-byte on them. Derive
// any change to the pattern from those two, not from the listing below:
//
// - RFC 3986 §2.3 unreserved (ALPHA / DIGIT / `-` / `.` / `_` / `~`), equivalent
//   to their literals per §6.2.2.2.
// - The sub-delims and gen-delims left in both: `!`, `'`, `(`, `)`, `*`, `[`,
//   `]`, `|`. Not §6.2.2.2-equivalent, but every decoding consumer collapses
//   them all the same, so leaving them encoded reopens the bypass for any guard
//   whose prefix contains one.
//
// Everything else is deliberately left alone, for one of three reasons:
//
// - The serializer would not keep the character: `%20`, `%5E`, `%7B`, `%5C` and
//   non-ASCII are re-encoded on the way back, and `%09`/`%0A`/`%0D` and the
//   other C0 controls would be *deleted* outright. `%2F`/`%5C` are structural
//   anyway — a `:param` must never gain a separator the router did not match on.
// - `decodeURI` does not decode it: `%24`, `%26`, `%2B`, `%2C`, `%3A`, `%3B`,
//   `%3D`, `%40` all survive serialization literally, so they are *not* excluded
//   for a reason of their own — they stay encoded only to keep parity with the
//   pass this replaced. A guard whose prefix contains one of those characters is
//   therefore still bypassable by its escape (`/%40admin` vs a `/@admin` guard)
//   for a consumer that decodes with `decodeURIComponent` rather than
//   `decodeURI`. Widening the set here would close that, at the cost of
//   diverging from what h3 has always dispatched.
// - `%25`: decoding it would turn `%252f` into a decodable `%2f`, handing a
//   double-decoding downstream the separator this whole pass exists to withhold.
//   (`decodeURI` already leaves it, so this is a property of the set, not an
//   extra carve-out.)
const NEEDLESS_ESCAPE_SRC = String.raw`%(?:2[1789ADE]|3[0-9]|4[1-9A-F]|5[0-9ABDF]|6[1-9A-F]|7[0-9ACE])`;
const NEEDLESS_ESCAPE_RE = /* @__PURE__ */ new RegExp(NEEDLESS_ESCAPE_SRC, "i");
const NEEDLESS_ESCAPE_RE_G = /* @__PURE__ */ new RegExp(NEEDLESS_ESCAPE_SRC, "gi");

/**
 * Whether `pathname` is *not* in canonical form, i.e. it carries a needless
 * escape and therefore names a resource that a decoding consumer reads under a
 * different path than the one h3 matched routes and middleware on.
 *
 * A single scan, no allocation — this runs on every request whose path contains
 * a `%`, and returns `false` for the common encodings (`%20`, `%2F`, non-ASCII).
 */
export function isNonCanonicalPathname(pathname: string): boolean {
  return NEEDLESS_ESCAPE_RE.test(pathname);
}

/**
 * Canonical form of `pathname`: needless escapes decoded, everything else left
 * byte-for-byte as it arrived.
 *
 * Idempotent by construction — no needless escape is left to decode — so the
 * result is a fixed point and re-canonicalizing it is a no-op. Dot segments need
 * no handling here: the URL parser resolves them (including every `%2e` spelling,
 * per WHATWG "double-dot path segment") before the pathname reaches h3, and
 * decoding a needless escape introduces no new segment boundary that could
 * reveal one. Re-parsing the result as a URL re-runs that resolution anyway.
 */
export function canonicalPathname(pathname: string): string {
  return pathname.replace(NEEDLESS_ESCAPE_RE_G, (m) =>
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
