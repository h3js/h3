import { withLeadingSlash } from "../../utils/internal/path.ts";

// Recognized method tokens for the optional `"METHOD /path"` key prefix; anything else is a plain path.
// Must stay in sync with h3's `HTTPMethod` (src/types/h3.ts): a method h3 can
// route but this set omits degrades into a literal path containing a space,
// which never matches a request.
const HTTP_METHODS = new Set([
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

/** Re-serialize a parsed key into its canonical `"METHOD /path"` / `"/path"` form. */
export function formatRouteKey(method: string, path: string): string {
  return method ? `${method} ${path}` : path;
}

// A maximal run of percent-escapes, decoded as a unit so a multi-byte sequence
// (`%C3%A9` → `é`) survives.
const ESCAPE_RUN_RE = /(?:%[\da-f]{2})+/gi;

// Decoded text that must not be substituted into a pattern: a path separator
// (`/`, `\`) would change the pattern's segment count, rou3 syntax (`:`, `*`,
// `(`, `)`) would turn a literal segment into a param/wildcard/regex, and a `%`
// would fabricate a new escape. The whole run is kept encoded when any appears.
const UNSAFE_DECODED_RE = /[/\\:*()%]/;

/**
 * Decode the percent-escapes in a rule *pattern* that stand for an ordinary
 * literal character, so a pattern spelled `/%40admin/**` becomes the same
 * pattern as `/@admin/**`.
 *
 * The matcher matches a `decodePreservingSeparators` reading of every request
 * path (see `decodedPath`), which is what makes a pattern written with the
 * character itself cover the encoded spelling. This is the other half: without
 * it an *encoded* pattern would silently cover only the encoded spelling —
 * under-protecting, since the raw spelling is the one clients normally send.
 *
 * Deliberately partial. An escape is decoded only when the character it stands
 * for cannot change how the pattern parses: a separator or rou3 syntax
 * (`:param`, `*`, `**`, regex/escaped params) stays encoded, so `/%3Aid` can
 * never turn into the `:id` param. Those spellings keep their pre-existing
 * (literal-only) behavior rather than silently changing meaning.
 *
 * Idempotent — decoding only ever removes escapes, never introduces one — which
 * the compiler's byte-identical codegen depends on.
 */
export function decodeRoutePattern(path: string): string {
  if (!path.includes("%")) {
    return path;
  }
  return path.replace(ESCAPE_RUN_RE, (run) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(run);
    } catch {
      return run; // Malformed (e.g. a lone `%C3`) — leave it exactly as authored.
    }
    return UNSAFE_DECODED_RE.test(decoded) ? run : decoded;
  });
}
