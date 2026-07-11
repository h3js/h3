import type { H3Event } from "../../event.ts";

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

/**
 * Apply `x-forwarded-*` headers derived from the incoming request onto the
 * given proxy headers (mutating and returning a `Headers` instance).
 *
 * `x-forwarded-for` / `x-forwarded-proto` are appended to any existing value;
 * `x-forwarded-host` / `x-forwarded-port` are only set when absent.
 */
export function applyXForwardedHeaders(headers: HeadersInit, event: H3Event): Headers {
  const merged = headers instanceof Headers ? headers : new Headers(headers);

  const ip = event.req.ip;
  if (ip) {
    const existing = merged.get("x-forwarded-for");
    merged.set("x-forwarded-for", existing ? `${existing}, ${ip}` : ip);
  }

  const proto = event.url.protocol.slice(0, -1); // strip trailing ":"
  if (proto) {
    const existing = merged.get("x-forwarded-proto");
    merged.set("x-forwarded-proto", existing ? `${existing}, ${proto}` : proto);
  }

  if (!merged.has("x-forwarded-host")) {
    merged.set("x-forwarded-host", event.url.host);
  }

  if (!merged.has("x-forwarded-port")) {
    merged.set("x-forwarded-port", event.url.port || (proto === "https" ? "443" : "80"));
  }

  return merged;
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
