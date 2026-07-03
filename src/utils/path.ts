export interface ResolveDotSegmentsOptions {
  /**
   * Also decode percent-encoded path separators (`%2f`, `%5c`) into real `/`
   * segment boundaries before resolving `.`/`..`.
   *
   * `event.url.pathname` never decodes `%2f` on its own, because doing so
   * would change how many segments a path has and therefore which route
   * matches — a correctness concern for dispatch, not just a security one
   * (e.g. `/files/:id` may rely on `%2F` to keep an id with a literal slash
   * as one opaque segment).
   *
   * Enable this only for out-of-band scope/security checks that must
   * anticipate a downstream decode — e.g. a reverse-proxy target or redirect
   * that will collapse `%2f` back to `/` on its own, letting an encoded
   * segment dodge a narrower rule at match time and then escape it once
   * decoded downstream. Never use the result for routing/dispatch.
   *
   * Only a single decode level is applied: a double-encoded separator like
   * `%252f` is left intact. If a downstream may decode more than once, run
   * the result through {@link resolveDotSegments} again until it is stable.
   *
   * @default false
   */
  decodeSlashes?: boolean;
}

/**
 * Resolve `.` and `..` segments in a path, without ever escaping above the
 * root `/`. The result is always an absolute path with a single leading `/`,
 * so it can never be protocol-relative (`//host`).
 *
 * Also decodes percent-encoded dot segments (`%2e`/`%2E`) and normalizes `\`
 * to `/`, so encoded or backslash-based traversal (e.g. `%2e%2e/`, `..\..\`)
 * is caught the same way as a literal `../`.
 *
 * `%2f`/`%5c` (encoded path separators) are left untouched by default — see
 * {@link ResolveDotSegmentsOptions.decodeSlashes}.
 */
export function resolveDotSegments(path: string, opts?: ResolveDotSegmentsOptions): string {
  // Normalize to a single leading slash (treating a leading `\` as a
  // separator). This keeps the `..` root clamp below well-defined for
  // otherwise-relative inputs and prevents a protocol-relative result.
  if (path[0] !== "/" || path[1] === "/" || path[1] === "\\") {
    path = "/" + path.replace(/^[/\\]+/, "");
  }
  const decodeSlashes = opts?.decodeSlashes;
  // TODO(perf): this guard is coarse — any `.` (every dotted filename) or any
  // `%2x` escape (e.g. `%20`) takes the slow path even without a real dot
  // segment. A boundary-aware check (dot adjacent to `/`/edges, and only
  // `%2e`/`%2f`/`%5c`) would keep the common serveStatic inputs on the fast
  // path. Needs its own benchmark, so deferred.
  const hasDotSegment = path.includes(".") || path.includes("%2");
  const hasBackslash = path.includes("\\");
  const hasEncodedSlash = decodeSlashes && /%2f|%5c/i.test(path);
  if (!hasDotSegment && !hasBackslash && !hasEncodedSlash) {
    return path;
  }
  // Normalize backslashes to forward slashes to prevent traversal via `\`
  let normalized = hasBackslash ? path.replaceAll("\\", "/") : path;
  if (hasEncodedSlash) {
    normalized = normalized.replace(/%2f|%5c/gi, "/");
  }
  const segments = normalized.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    // Decode percent-encoded dots (%2e/%2E) to catch double-encoded traversal
    const normalizedSegment = segment.replace(/%2e/gi, ".");
    if (normalizedSegment === "..") {
      // Never pop past the root (first empty segment from leading slash)
      if (resolved.length > 1) {
        resolved.pop();
      }
    } else if (normalizedSegment !== ".") {
      resolved.push(segment);
    }
  }
  const result = resolved.join("/") || "/";
  // Decoded/normalized separators can prepend extra empty segments; collapse
  // them so the result stays a single-rooted, non protocol-relative path.
  return result[1] === "/" ? result.replace(/^\/+/, "/") : result;
}
