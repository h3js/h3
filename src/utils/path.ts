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
   * @default false
   */
  decodeSlashes?: boolean;
}

/**
 * Resolve `.` and `..` segments in a path, without ever escaping above the
 * root `/`.
 *
 * Also decodes percent-encoded dot segments (`%2e`/`%2E`) and normalizes `\`
 * to `/`, so encoded or backslash-based traversal (e.g. `%2e%2e/`, `..\..\`)
 * is caught the same way as a literal `../`.
 *
 * `%2f`/`%5c` (encoded path separators) are left untouched by default — see
 * {@link ResolveDotSegmentsOptions.decodeSlashes}.
 */
export function resolveDotSegments(path: string, opts?: ResolveDotSegmentsOptions): string {
  const decodeSlashes = opts?.decodeSlashes;
  const hasDotSegment = path.includes(".") || path.includes("%2");
  const hasEncodedSlash = decodeSlashes && /%2f|%5c/i.test(path);
  if (!hasDotSegment && !hasEncodedSlash) {
    return path;
  }
  let normalized = path.replaceAll("\\", "/");
  if (decodeSlashes) {
    normalized = normalized.replace(/%2f/gi, "/").replace(/%5c/gi, "/");
  }
  const segments = normalized.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
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
  return resolved.join("/") || "/";
}
