export const PayloadMethods: Set<string> = new Set(["PATCH", "POST", "PUT", "DELETE", "QUERY"]);

export const ignoredHeaders: Set<string> = new Set([
  "transfer-encoding",
  // `accept-encoding` is stripped because fetch auto-decompresses upstream
  // responses; forwarding the client's value would advertise encodings we
  // then transparently decode. The client's `accept` header is forwarded so
  // upstream content negotiation (JSON vs HTML) keeps working behind the proxy.
  "accept-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "host",
]);

/**
 * Hop-by-hop response headers (plus length/encoding headers that fetch has
 * already normalized) that must be stripped from the upstream response instead
 * of being relayed to the client.
 */
export const ignoredResponseHeaders: Set<string> = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-connection",
  "upgrade",
  "trailer",
  "te",
]);

export function rewriteCookieProperty(
  header: string,
  map: string | Record<string, string>,
  property: string,
): string {
  const _map = typeof map === "string" ? { "*": map } : map;
  return header.replace(
    new RegExp(`(;\\s*${property}=)([^;]+)`, "gi"),
    (match, prefix, previousValue) => {
      let newValue;
      if (previousValue in _map) {
        newValue = _map[previousValue];
      } else if ("*" in _map) {
        newValue = _map["*"];
      } else {
        return match;
      }
      return newValue ? prefix + newValue : "";
    },
  );
}

export function mergeHeaders(
  defaults: HeadersInit,
  ...inputs: (HeadersInit | undefined)[]
): HeadersInit {
  const _inputs = inputs.filter(Boolean) as HeadersInit[];
  if (_inputs.length === 0) {
    return defaults;
  }
  const merged = new Headers(defaults);
  for (const input of _inputs) {
    const entries = Array.isArray(input)
      ? input
      : typeof input.entries === "function"
        ? input.entries()
        : Object.entries(input);
    for (const [key, value] of entries) {
      if (value !== undefined) {
        merged.set(key, value);
      }
    }
  }
  return merged;
}
