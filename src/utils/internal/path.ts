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

const JOIN_LEADING_SLASH_RE = /^\//;

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

// Percent-escapes that are *needless*: anything downstream that decodes the path
// (a proxy, a filesystem lookup, `serveStatic`'s own `decodeURI` peel, a handler
// calling `decodeURIComponent`) resolves the escape and its literal to the same
// resource, while h3's matchers compare them as two different strings. That gap
// is the middleware-bypass vector — `/%61dmin` reaching the `/admin` route past
// an `/admin` guard — so such a path is decoded to its canonical form before
// anything can match on it.
//
// The set is every escape whose decoded character survives WHATWG path
// serialization unchanged, minus the two that must stay opaque:
//
// - `%2F`, whose character is the segment separator. Decoding it would change
//   how many segments the path has, so a `:param` could gain a boundary the
//   router never matched on.
// - `%25`, whose character starts an escape. Decoding it would turn `%252f`
//   into a decodable `%2f`, handing a double-decoding downstream the separator
//   this whole pass exists to withhold.
//
// What is left is `!`, `$`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `-`, `.`, `:`,
// `;`, `=`, `@`, `[`, `]`, `_`, `|`, `~`, ALPHA and DIGIT — the RFC 3986 §2.3
// unreserved set, equivalent to its literals per §6.2.2.2, plus the sub-delims
// and gen-delims the serializer keeps literal. Those are not §6.2.2.2-equivalent
// in the abstract, but every decoding consumer collapses them all the same, so
// leaving one encoded reopens the bypass for any guard whose prefix contains it
// (`/%40admin` vs a `/@admin` guard).
//
// Everything the serializer would *not* keep is excluded for free, because
// decoding it could not change what anything matches: `%20`, `%22`, `%3C`,
// `%3E`, `%5E`, `%60`, `%7B`, `%7D` and non-ASCII are re-encoded on the way
// back, `%23`/`%3F` would be re-encoded rather than start a fragment or query,
// `%5C` would be normalized into a real `/`, and `%09` and the other C0 controls
// would be *deleted* outright. The last two are why this decodes selectively
// instead of running `decodeURI` and re-parsing: that pass mangled them.
//
// Note this is wider than `decodeURI`, which preserves all of RFC 3986's
// reserved set (`; / ? : @ & = + $ ,`) — of which only `/` is structural here.
const NEEDLESS_ESCAPE_SRC = String.raw`%(?:2[146-9A-E]|3[0-9ABD]|4[0-9A-F]|5[0-9ABDF]|6[1-9A-F]|7[0-9ACE])`;
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

// A route pattern is a *pathname*, never a URL: `http://evil.com/admin` used to
// be parsed as one and silently registered at `/admin` on this app, and
// `//admin` at `/` — a pattern that reads as scoped mounting a handler at the
// root. Both are rejected/kept-literal instead (see `normalizeRoute`).
const ABSOLUTE_URL_RE = /^[a-z][a-z\d+\-.]*:\/\//i;

// Characters that a request's `event.url.pathname` always carries percent-encoded
// (the WHATWG path percent-encode set) and that carry no meaning in a rou3
// pattern, so encoding them here is what makes `use("/café/**")` scope the route
// `get("/café/secret")` registers as `/caf%C3%A9/secret`.
//
// Deliberately *not* encoded, even though the URL serializer encodes them:
// `?` `{` `}` `^` — rou3 pattern syntax (optional params `:id?`, groups `{x}`)
// or regex operators inside a `(...)` segment. A pattern needing one of those as
// a *literal* must spell it percent-encoded (`%3F`, `%7B`, `%7D`, `%5E`).
// `\` is rou3's escape character and is likewise left alone — the URL parser
// turned it into `/`, which silently rewrote `/user/:id(\d+)` to `/user/:id(/d+)`.
// eslint-disable-next-line no-control-regex -- encoding controls is the point
const ROUTE_ENCODE_RE = /[\u0000-\u0020"#<>\u0060]|[^\u0000-\u007E]/gu;

/**
 * Canonical form of a route *pattern*, in the same shape as the
 * `event.url.pathname` it will be matched against.
 *
 * Shared by `on()`, `use(route, …)`, `mount()` and `removeRoute()`: a pattern
 * that normalized differently depending on which one received it let a request
 * reach a handler while the guard registered with the same source string matched
 * nothing — guards failing open.
 *
 * Rejects absolute URLs; everything else is treated as a pathname: a leading
 * slash is added if missing, characters the URL serializer would percent-encode
 * are encoded (minus rou3 syntax, see {@link ROUTE_ENCODE_RE}), needless escapes
 * are decoded by {@link canonicalPathname}, and `.`/`..` segments are resolved
 * the way the URL parser resolves them in a request path. Idempotent.
 */
export function normalizeRoute(route: string): string {
  if (ABSOLUTE_URL_RE.test(route)) {
    throw new Error(`Route patterns are pathnames, received URL: ${route}`);
  }
  if (route.charCodeAt(0) !== 47 /* / */) {
    route = `/${route}`;
  }
  // `encodeURIComponent` ignores `replace`'s extra arguments. It throws on a
  // lone surrogate, which is then reported as an invalid route rather than
  // silently substituted.
  route = canonicalPathname(route.replace(ROUTE_ENCODE_RE, encodeURIComponent as () => string));
  // A `.`/`..` segment is one the URL parser would have resolved away in a
  // request path, so a pattern carrying one could never be reached.
  return route.includes("/.") ? resolveDotSegments(route) : route;
}

function resolveDotSegments(pathname: string): string {
  const out: string[] = [];
  let dot = false;
  for (const segment of pathname.split("/")) {
    dot = segment === "." || segment === "..";
    if (!dot) {
      out.push(segment);
    } else if (segment.length === 2 && out.length > 1) {
      out.pop();
    }
  }
  if (dot) {
    out.push(""); // a resolved trailing dot segment leaves a trailing slash
  }
  return out.join("/");
}

/**
 * Decoded `pathname`, or `undefined` when it carries malformed percent-encoding
 * — a truncated escape (`/foo%`, `/bar%2`), a non-hex one (`/%ZZ`) or an invalid
 * UTF-8 sequence (`/%80`). Such a path has no canonical form to decode to.
 *
 * Returns the decoded value rather than a boolean so that the `decodeURI` call
 * is *consumed*: bundlers treat it as pure, and rolldown (the bundler `pnpm
 * build` uses) deletes a bare `decodeURI(pathname);` whose result nothing reads
 * — which shipped this guard as `try { return false } catch {}` in `dist`, i.e.
 * no guard at all. Keep the value flowing to the caller; `test/dist.test.ts`
 * asserts the built output still rejects these paths.
 */
export function decodePathname(pathname: string): string | undefined {
  try {
    return decodeURI(pathname);
  } catch {
    return undefined;
  }
}

// Percent-encoded path separators (`%2f` → `/`, `%5c` → `\`). The `nested`
// form also matches every `%25`-nesting depth (`%252f`, ...); the flat one only
// the bare escape, for a consumer that decodes exactly once (see
// {@link DecodePreservingSeparatorsOptions.nested}). Module-scope and reset
// before each use — the `g` flag is only there to walk every occurrence.
const ENCODED_SEP_RE_G = /%(?:25)*(?:2f|5c)/gi;
const ENCODED_SEP_FLAT_RE_G = /%(?:2f|5c)/gi;

export interface DecodePreservingSeparatorsOptions {
  /**
   * Decoder applied to everything between the held-back separators.
   *
   * Defaults to `decodeURIComponent`. Pass `decodeURI` for a consumer that must
   * also keep RFC 3986's reserved set encoded (`%23`, `%3f`, ...) — `serveStatic`
   * does, so an id it hands a URL-composing backend cannot grow a `?`/`#`.
   *
   * @default decodeURIComponent
   */
  decode?: (input: string) => string;

  /**
   * Hold the separator back at every `%25`-nesting depth (`%252f`, `%25252f`, ...),
   * not just the bare `%2f`/`%5c`.
   *
   * Keep this on for a consumer whose value may be decoded again downstream — one
   * more decode is exactly what unwraps a nested form into a real separator.
   *
   * Turn it off for a strictly *single*-decode consumer: peeling one `%25` level
   * off `%252f` yields a literal `%2f`, which is still not a separator, and
   * withholding it instead would break the on-disk lookup of a file whose name
   * genuinely contains `%2f`.
   *
   * @default true
   */
  nested?: boolean;
}

/**
 * `decodeURIComponent` a path (or a single path segment), but never let an
 * encoded path separator collapse into a raw `/` or `\`.
 *
 * Decoding a separator would reintroduce a boundary (and thus `..`-based
 * traversal) that routing and pathname-based middleware never saw — a path
 * desync / smuggling vector. So the encoded separators are kept in their
 * encoded form while every other escape decodes normally.
 *
 * `%25`-nested forms (`%252f`, ...) are held back at every depth by default,
 * which is what a second decode would otherwise unwrap
 * (see {@link DecodePreservingSeparatorsOptions.nested}). {@link canonicalPathname}
 * never decodes `%25` either — and can itself *produce* a nested form, turning
 * `%25%32%66` into `%252f`.
 *
 * What still decodes here that canonicalization leaves alone: `%20`, non-ASCII
 * (`%C3%A9`), the escapes the URL serializer re-adds (`%22 %3C %3E %5E %60 %7B
 * %7D`), and the C0 controls. The needless set (`%40`, `%3b`, ...) is already
 * decoded in `event.url.pathname`, so for an h3 pathname this pass is about the
 * remainder.
 *
 * Throws on malformed percent-encoding, like `decodeURIComponent` itself.
 *
 * Shared by {@link import("../request.ts").getRouterParams}'s `decode: true`,
 * the route-rules matcher's decoded reading and
 * {@link import("../static.ts").serveStatic}'s on-disk id, so they cannot
 * disagree about what "decoded" means — and so none of them can grow a
 * separator the router never matched on.
 */
export function decodePreservingSeparators(
  value: string,
  opts?: DecodePreservingSeparatorsOptions,
): string {
  if (!value.includes("%")) {
    return value; // Fast path: nothing to decode.
  }
  const decode = opts?.decode || decodeURIComponent;
  const re = opts?.nested === false ? ENCODED_SEP_FLAT_RE_G : ENCODED_SEP_RE_G;
  // Decode around the encoded separators: split on them, decode the pieces, and
  // rejoin keeping each separator in its original (encoded) form so it can never
  // become a raw separator. Splitting only ever cuts at a whole escape, so every
  // piece handed to `decode` still has intact percent-encoding.
  let result = "";
  let lastIndex = 0;
  re.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(value));) {
    result += decode(value.slice(lastIndex, m.index)) + m[0];
    lastIndex = m.index + m[0].length;
  }
  return result + decode(value.slice(lastIndex));
}
