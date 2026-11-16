import { isNonCanonicalPathname } from "../utils/internal/path.ts";
import {
  canonicalPath,
  decodedPath,
  encodedReading,
  mergedCanonicalPath,
  needsCanonicalPasses,
} from "./internal/scope.ts";

/**
 * Every alternate spelling of `pathname` a route rule is also matched against,
 * deduped and excluding `pathname` itself (`undefined` when there is none).
 * Ordered least → most derived, which is the order their matches are unioned in.
 *
 * Use it to match rules outside `h3/rules` (for example a client-side matcher)
 * on the same set of paths as `createMatcherFromFind`. The readings are
 * for rule matching only: never dispatch or forward them.
 *
 * Three things make a path resolve differently downstream than it dispatches:
 *
 * - **An encoded separator** (`%2f`) must not dodge a rule the canonical path
 *   would hit (`admin%2fpanel` vs `admin/panel`) — an ordinary reverse proxy
 *   decodes it back.
 * - **An empty `//` segment** survives h3's canonical form but rou3 won't match
 *   it against `/admin/**`, so a slash-merging downstream (nginx
 *   `merge_slashes`) could reach a path whose gate never ran — hence the second,
 *   slash-merged reading (mirroring `isPathInScope`'s two interpretations).
 * - **An escape h3 serves opaque** — one the URL serializer would re-add (`%20`,
 *   non-ASCII, `%22 %3C %3E %5E %60 %7B %7D`), a C0 control, or `%25` at any
 *   nesting depth (`%2540`). h3's pathname decodes only the *needless* escapes
 *   (`canonicalPathname`, so `/%40admin` already arrives as `/@admin`), while a
 *   rule pattern is written with the character itself (`/a b/**`). Without the
 *   `decodedPath` reading, `/a%20b/...` walks past that gate and a proxied
 *   backend — or any consumer that decodes — serves it as `/a b/...`.
 *   A consumer that decodes also *resolves*, so when the decoded path is not
 *   itself canonical it contributes its canonical readings rather than the
 *   intermediate spelling — which is also what catches a dot segment whose hex
 *   digits were themselves encoded (`%25%32%65` → `%2e` → `.`).
 *
 * Fast path: a pathname already canonical under the strictest reading is
 * canonical under every weaker one, and one with no `%` has nothing to decode,
 * so no reading can differ from the served path — an `includes("%")` and one
 * h3-owned scan (`isCanonicalPath` via `needsCanonicalPasses`, never a local
 * copy of the decode set, which would go stale silently) skip every resolve and
 * every extra lookup.
 */
export function alternatePathReadings(pathname: string): string[] | undefined {
  // Hex case is not meaningful in a URL (RFC 3986 §6.2.2.1), but a rule key
  // keeps its escapes as written, like its route (`decodeRoutePattern`), so
  // the served path is also looked up recased to uppercase and lowercase hex —
  // verbatim, before a canonical pass could decode a `%2F` the key spells
  // literally. Only for a canonical pathname (every one h3 serves): a needless
  // escape never appears in a key, so recasing one could only repeat a lookup.
  const recase = pathname.includes("%") && !isNonCanonicalPathname(pathname);
  const upper = recase ? recaseEscapes(pathname, true) : pathname;
  const lower = recase ? recaseEscapes(pathname, false) : pathname;
  // rou3 stores pattern literals percent-encoded but leaves regex constraints
  // as written, so the decoded reading is looked up in both spellings:
  // re-encoded for `/a b/**` (stored `/a%20b/**`), raw for `/(café|tea)/**`.
  // The re-encoded spelling is uppercase; its lowercase recasing reaches a key
  // spelled in lowercase hex from a nested spelling (`%25c3%25a9`).
  const decoded = decodedPath(pathname);
  const encoded = encodedReading(decoded);
  const lowerEncoded = recaseEscapes(encoded, false);
  if (
    upper === pathname &&
    lower === pathname &&
    decoded === pathname &&
    encoded === pathname &&
    lowerEncoded === pathname &&
    !needsCanonicalPasses(pathname)
  ) {
    return;
  }
  const readings: string[] = [];
  pushReading(readings, pathname, upper);
  pushReading(readings, pathname, lower);
  const spellings = [pathname];
  for (const spelling of [encoded, lowerEncoded, decoded]) {
    if (!spellings.includes(spelling)) {
      spellings.push(spelling);
    }
  }
  for (const spelling of spellings) {
    if (!needsCanonicalPasses(spelling)) {
      pushReading(readings, pathname, spelling);
      continue;
    }
    const canonical = canonicalPath(spelling);
    pushReading(readings, pathname, canonical);
    const merged = mergedCanonicalPath(spelling, canonical);
    if (merged !== undefined) {
      pushReading(readings, pathname, merged);
    }
  }
  return readings.length > 0 ? readings : undefined;
}

// A percent-escape, in either hex case.
const ESCAPE_RE_G = /%[\da-f]{2}/gi;

/** `path` with every percent-escape's hex digits upper- or lowercased. */
export function recaseEscapes(path: string, upper: boolean): string {
  return path.includes("%")
    ? path.replace(ESCAPE_RE_G, (escape) => (upper ? escape.toUpperCase() : escape.toLowerCase()))
    : path;
}

function pushReading(readings: string[], pathname: string, reading: string): void {
  if (reading !== pathname && !readings.includes(reading)) {
    readings.push(reading);
  }
}
