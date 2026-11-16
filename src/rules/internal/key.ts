import { normalizeRoute, withLeadingSlash } from "../../utils/internal/path.ts";

// Recognized method tokens for the optional `"METHOD /path"` key prefix; anything else is a plain path.
// Must stay in sync with h3's `HTTPMethod` (src/types/h3.ts): a method h3 can
// route but this set omits degrades into a literal path containing a space,
// which never matches a request.
export const HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
  "QUERY",
]);

const METHOD_KEY_RE = /^([A-Za-z]+)\s+(\/.*)$/;

export interface ParsedRouteKey {
  /** Uppercased HTTP method, or `""` for a method-agnostic (all-methods) rule. */
  method: string;
  /** Path pattern with a guaranteed leading slash. */
  path: string;
}

/**
 * Parse a route-rule key into `{ method, path }`.
 *
 * - `"GET /api/**"` → `{ method: "GET", path: "/api/**" }`
 * - `"/api/**"`     → `{ method: "", path: "/api/**" }`
 *
 * Only a recognized HTTP method (case-insensitive) followed by a space and a
 * slash-prefixed path counts as method-scoped; everything else is a plain path.
 */
export function parseRouteKey(key: string): ParsedRouteKey {
  const match = METHOD_KEY_RE.exec(key);
  if (match) {
    const method = match[1]!.toUpperCase();
    if (HTTP_METHODS.has(method)) {
      return { method, path: withLeadingSlash(match[2]!) };
    }
  }
  return { method: "", path: withLeadingSlash(key) };
}

/**
 * The method-looking token of a key that {@link parseRouteKey} reads as a plain
 * path — a `WORD /path` prefix whose word is not a recognized HTTP method — or
 * `undefined` when the key has no such prefix.
 *
 * Such a key is almost always a typo'd method (`GTE /admin/**`): it degrades
 * into a literal path containing a space, which never matches a request, so a
 * gate authored that way silently fails open. Normalization rejects it via this
 * check; the parse itself stays lenient because it also runs on
 * already-normalized keys at router build time. A genuine literal path with a
 * word-space prefix can be spelled with a leading slash (`/FOO bar`), which
 * this never flags.
 */
export function unknownMethodPrefix(key: string): string | undefined {
  const match = METHOD_KEY_RE.exec(key);
  return match && !HTTP_METHODS.has(match[1]!.toUpperCase()) ? match[1] : undefined;
}

/** Re-serialize a parsed key into its canonical `"METHOD /path"` / `"/path"` form. */
export function formatRouteKey(method: string, path: string): string {
  return method ? `${method} ${path}` : path;
}

/**
 * Canonicalize a rule *pattern* into exactly the pattern h3 registers for the
 * same string as a route ({@link normalizeRoute}: `H3.route`, `use()`,
 * `mount()`), so the rule matches every request its route serves, spelled the
 * way that route is spelled.
 *
 * Needless escapes decode (`/%40admin/**` → `/@admin/**`, as for every request
 * path), so an escaped rou3 metacharacter becomes one in both (`/a/%3Aid` is the
 * `:id` param route); raw text the URL serializer would encode is encoded
 * (`/café` → `/caf%C3%A9`, constraint text included — rou3 never encodes a
 * constraint itself); dot segments resolve. Every other escape stays exactly as
 * written: decoding `%7B` or `%3F` would turn a literal into rou3 group or
 * optional syntax, an escape inside a constraint is literal regex text, and
 * recasing one would make the key miss its own route's spelling. Other spellings
 * of a request (decoded, nested, hex-recased) are the matcher's alternate
 * readings (see `alternatePathReadings`).
 *
 * Idempotent, which the compiler's byte-identical codegen depends on: run to a
 * fixpoint because canonicalizing can fabricate a new escape (`%2%31` → `%21`)
 * that a second call would decode. It terminates: only the first round encodes,
 * and every later change shortens the path.
 */
export function decodeRoutePattern(path: string): string {
  for (let prev = ""; prev !== path;) {
    prev = path;
    path = normalizeRoute(path);
  }
  return path;
}
