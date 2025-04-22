export const PayloadMethods = new Set(["PATCH", "POST", "PUT", "DELETE"]);

export const ignoredHeaders = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "host",
  "accept",
]);

export function getFetch<T = typeof fetch>(_fetch?: T) {
  if (_fetch) {
    return _fetch;
  }
  if (globalThis.fetch) {
    return globalThis.fetch;
  }
  throw new Error(
    "fetch is not available. Try importing `node-fetch-native/polyfill` for Node.js.",
  );
}

export function rewriteCookieProperty(
  header: string,
  map: string | Record<string, string>,
  property: string,
) {
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
) {
  const _inputs = inputs.filter(Boolean) as HeadersInit[];
  if (_inputs.length === 0) {
    return defaults;
  }
  const merged = new Headers(defaults);
  for (const input of _inputs) {
    for (const [key, value] of Object.entries(input!)) {
      if (value !== undefined) {
        merged.set(key, value);
      }
    }
  }
  return merged;
}
