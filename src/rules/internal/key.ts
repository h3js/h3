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
