import { type ErrorDetails, HTTPError } from "../error.ts";
import { decodePathname, stripBase } from "./internal/path.ts";
import { parseQuery } from "./internal/query.ts";
import { validateData } from "./internal/validate.ts";
import { getEventContext } from "./event.ts";

import type { StandardSchemaV1, FailureResult, InferOutput } from "./internal/standard-schema.ts";
import type { ValidateResult, OnValidateError } from "./internal/validate.ts";
import type { H3Event, HTTPEvent } from "../event.ts";
import type { InferEventInput } from "../types/handler.ts";
import type { HTTPMethod } from "../types/h3.ts";
import type { H3EventContext } from "../types/context.ts";
import type { ServerRequest } from "srvx";

/**
 * Create a lightweight request proxy that overrides only the URL.
 *
 * Avoids cloning the original request (no `new Request()` allocation).
 */
export function requestWithURL(req: ServerRequest, url: string): ServerRequest {
  // Shadow `_url` too: the runtime-parsed URL object reflects the original
  // request URL and consumers must re-parse the overridden `url` instead.
  const cache: Record<string | symbol, unknown> = { url, _url: undefined };
  return new Proxy(req, {
    get(target, prop) {
      if (prop in cache) return cache[prop];
      const value = Reflect.get(target, prop);
      cache[prop] = typeof value === "function" ? value.bind(target) : value;
      return cache[prop];
    },
  });
}

/**
 * Create a lightweight request proxy with the base path stripped from the URL pathname.
 */
export function requestWithBaseURL(req: ServerRequest, base: string): ServerRequest {
  const url = new URL(req.url);
  let pathname: string;
  try {
    pathname = decodePathname(url.pathname);
  } catch {
    // Malformed percent-encoding: fall back to the raw pathname instead of throwing.
    pathname = url.pathname;
  }
  url.pathname = stripBase(pathname, base);
  return requestWithURL(req, url.href);
}

/**
 * Convert input into a web [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request).
 *
 * If input is a relative URL, it will be normalized into a full path based on headers.
 *
 * If input is already a Request and no options are provided, it will be returned as-is.
 */
export function toRequest(
  input: ServerRequest | URL | string,
  options?: RequestInit,
): ServerRequest {
  if (typeof input === "string") {
    let url = input;
    if (url[0] === "/") {
      const headers = options?.headers ? new Headers(options.headers) : undefined;
      const host = headers?.get("host") || "localhost";
      const proto =
        (headers?.get("x-forwarded-proto") || "").split(",")[0].trim() === "https"
          ? "https"
          : "http";
      url = `${proto}://${host}${url}`;
    }
    return new Request(url, options);
  } else if (options || input instanceof URL) {
    return new Request(input, options);
  }
  return input;
}

/**
 * Get parsed query string object from the request URL.
 *
 * @example
 * app.get("/", (event) => {
 *   const query = getQuery(event); // { key: "value", key2: ["value1", "value2"] }
 * });
 */
export function getQuery<
  T,
  Event extends H3Event | HTTPEvent = HTTPEvent,
  _T = Exclude<InferEventInput<"query", Event, T>, undefined>,
>(event: Event): _T {
  const url = (event as H3Event).url || new URL(event.req.url);
  return parseQuery(url.search.slice(1)) as _T;
}

export function getValidatedQuery<Event extends HTTPEvent, S extends StandardSchemaV1<any, any>>(
  event: Event,
  validate: S,
  options?: { onError?: (result: FailureResult) => ErrorDetails },
): Promise<InferOutput<S>>;
export function getValidatedQuery<
  Event extends HTTPEvent,
  OutputT,
  InputT = InferEventInput<"query", Event, OutputT>,
>(
  event: Event,
  validate: (data: InputT) => ValidateResult<OutputT> | Promise<ValidateResult<OutputT>>,
  options?: {
    onError?: () => ErrorDetails;
  },
): Promise<OutputT>;
/**
 * Get the query param from the request URL validated with validate function.
 *
 * You can use a simple function to validate the query object or use a Standard-Schema compatible library like `zod` to define a schema.
 *
 * @example
 * app.get("/", async (event) => {
 *   const query = await getValidatedQuery(event, (data) => {
 *     return "key" in data && typeof data.key === "string";
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * app.get("/", async (event) => {
 *   const query = await getValidatedQuery(
 *     event,
 *     z.object({
 *       key: z.string(),
 *     }),
 *   );
 * });
 * @example
 * import * as v from "valibot";
 *
 * app.get("/", async (event) => {
 *   const params = await getValidatedQuery(
 *     event,
 *     v.object({
 *       key: v.string(),
 *     }),
 *     {
 *       onError: ({ issues }) => ({
 *         statusText: "Custom validation error",
 *         message: v.summarize(issues),
 *       }),
 *     },
 *   );
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param validate The function to use for query validation. It will be called passing the read request query. If the result is not false, the parsed query will be returned.
 * @param options Optional options. If provided, the `onError` function will be called with the validation issues if validation fails.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request query.
 * @see {getQuery}
 */
export function getValidatedQuery(
  event: HTTPEvent,
  validate: any,
  options?: {
    onError?: OnValidateError;
  },
): Promise<any> {
  const query = getQuery(event);
  return validateData(query, validate, options);
}

/**
 * Get matched route params.
 *
 * If `decode` option is `true`, it will decode the matched route params (like
 * `decodeURIComponent`), except encoded path separators (`%2f`, `%5c`) are kept
 * encoded so decoding can never reintroduce a `/` or `\` the router never matched.
 *
 * @example
 * app.get("/", (event) => {
 *   const params = getRouterParams(event); // { key: "value" }
 * });
 */
export function getRouterParams(
  event: HTTPEvent,
  opts: { decode?: boolean } = {},
): NonNullable<H3Event["context"]["params"]> {
  // Fallback object needs to be returned in case router is not used (#149)
  const context = getEventContext<H3EventContext>(event);
  let params = (context.params || {}) as NonNullable<H3Event["context"]["params"]>;
  if (opts.decode) {
    params = { ...params };
    for (const key in params) {
      params[key] = decodeRouterParam(params[key]);
    }
  }
  return params;
}

// Percent-encoded path separators (`%2f` → `/`, `%5c` → `\`) at any `%25`-nesting
// depth (`%2f`, `%252f`, ...). Whatever reaches a param already survived the pathname
// decode in `event.ts` (a single `decodeURI` that preserves `%25`) still encoded:
// `decodeURI` keeps `%2f` as a reserved char, and `%25`-nested forms (`%252f`,
// `%255c`, ...) only lose one `%25` level. A bare `%5c` never reaches a param at all —
// it decodes to `\`, which the URL parser normalizes into a real `/` the router splits
// on — but it stays in the pattern as a cheap guard. Either way, route matching and any
// pathname-based middleware only ever saw the matched param as one opaque, still-encoded
// segment (a `:id` capture can never hold a raw separator).
const ENCODED_SEP_RE_G = /%(?:25)*(?:2f|5c)/gi;

/**
 * `decodeURIComponent` a matched route param, but never let an encoded path
 * separator collapse into a raw `/` or `\`.
 *
 * A full second decode on top of the already-once-decoded pathname would
 * reintroduce a separator (and thus `..`-based traversal) the routing/middleware
 * layer could not see — a path desync / smuggling vector when the decoded param
 * feeds a filesystem or upstream path. So the encoded separators are kept in
 * their encoded form while every other escape (spaces, non-ASCII, ...) still
 * decodes normally, keeping `decode:true` human-readable.
 */
function decodeRouterParam(value: string): string {
  if (!value.includes("%")) {
    return value; // Fast path: nothing to decode.
  }
  // Decode around the encoded separators: split on them, decode the pieces, and
  // rejoin keeping each separator in its original (encoded) form so it can never
  // become a raw separator.
  let result = "";
  let lastIndex = 0;
  ENCODED_SEP_RE_G.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = ENCODED_SEP_RE_G.exec(value));) {
    result += decodeURIComponent(value.slice(lastIndex, m.index)) + m[0];
    lastIndex = m.index + m[0].length;
  }
  return result + decodeURIComponent(value.slice(lastIndex));
}

export function getValidatedRouterParams<Event extends HTTPEvent, S extends StandardSchemaV1>(
  event: Event,
  validate: S,
  options?: {
    decode?: boolean;
    onError?: (result: FailureResult) => ErrorDetails;
  },
): Promise<InferOutput<S>>;
export function getValidatedRouterParams<
  Event extends HTTPEvent,
  OutputT,
  InputT = InferEventInput<"routerParams", Event, OutputT>,
>(
  event: Event,
  validate: (data: InputT) => ValidateResult<OutputT> | Promise<ValidateResult<OutputT>>,
  options?: {
    decode?: boolean;
    onError?: () => ErrorDetails;
  },
): Promise<OutputT>;
/**
 * Get matched route params and validate with validate function.
 *
 * If `decode` option is `true`, it will decode the matched route params (like
 * `decodeURIComponent`), except encoded path separators (`%2f`, `%5c`) are kept
 * encoded so decoding can never reintroduce a `/` or `\` the router never matched.
 *
 * You can use a simple function to validate the params object or use a Standard-Schema compatible library like `zod` to define a schema.
 *
 * @example
 * app.get("/:key", async (event) => {
 *   const params = await getValidatedRouterParams(event, (data) => {
 *     return "key" in data && typeof data.key === "string";
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * app.get("/:key", async (event) => {
 *   const params = await getValidatedRouterParams(
 *     event,
 *     z.object({
 *       key: z.string(),
 *     }),
 *   );
 * });
 * @example
 * import * as v from "valibot";
 *
 * app.get("/:key", async (event) => {
 *   const params = await getValidatedRouterParams(
 *     event,
 *     v.object({
 *       key: v.pipe(v.string(), v.picklist(["route-1", "route-2", "route-3"])),
 *     }),
 *     {
 *       decode: true,
 *       onError: ({ issues }) => ({
 *         statusText: "Custom validation error",
 *         message: v.summarize(issues),
 *       }),
 *     },
 *   );
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param validate The function to use for router params validation. It will be called passing the read request router params. If the result is not false, the parsed router params will be returned.
 * @param options Optional options. If provided, the `onError` function will be called with the validation issues if validation fails.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request router params.
 * @see {getRouterParams}
 */
export function getValidatedRouterParams(
  event: HTTPEvent,
  validate: any,
  options: {
    decode?: boolean;
    onError?: OnValidateError;
  } = {},
): Promise<any> {
  const { decode, ...opts } = options;
  const routerParams = getRouterParams(event, { decode });
  return validateData(routerParams, validate, opts);
}

/**
 * Get a matched route param by name.
 *
 * If `decode` option is `true`, it will decode the matched route param (like
 * `decodeURIComponent`), except encoded path separators (`%2f`, `%5c`) are kept
 * encoded so decoding can never reintroduce a `/` or `\` the router never matched.
 *
 * @example
 * app.get("/", (event) => {
 *   const param = getRouterParam(event, "key");
 * });
 */
export function getRouterParam(
  event: HTTPEvent,
  name: string,
  opts: { decode?: boolean } = {},
): string | undefined {
  const params = getRouterParams(event, opts);
  return params[name];
}

/**
 *
 * Checks if the incoming request method is of the expected type.
 *
 * If `allowHead` is `true`, it will allow `HEAD` requests to pass if the expected method is `GET`.
 *
 * @example
 * app.get("/", (event) => {
 *   if (isMethod(event, "GET")) {
 *     // Handle GET request
 *   } else if (isMethod(event, ["POST", "PUT"])) {
 *     // Handle POST or PUT request
 *   }
 * });
 */
export function isMethod(
  event: HTTPEvent,
  expected: HTTPMethod | HTTPMethod[],
  allowHead?: boolean,
): boolean {
  if (allowHead && event.req.method === "HEAD") {
    return true;
  }

  if (typeof expected === "string") {
    if (event.req.method === expected) {
      return true;
    }
  } else if (expected.includes(event.req.method as HTTPMethod)) {
    return true;
  }

  return false;
}

/**
 * Asserts that the incoming request method is of the expected type using `isMethod`.
 *
 * If the method is not allowed, it will throw a 405 error and include an `Allow`
 * response header listing the permitted methods, as required by RFC 9110.
 *
 * If `allowHead` is `true`, it will allow `HEAD` requests to pass if the expected method is `GET`.
 *
 * @example
 * app.get("/", (event) => {
 *   assertMethod(event, "GET");
 *   // Handle GET request, otherwise throw 405 error
 * });
 */
export function assertMethod(
  event: HTTPEvent,
  expected: HTTPMethod | HTTPMethod[],
  allowHead?: boolean,
): void {
  if (!isMethod(event, expected, allowHead)) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    throw new HTTPError({
      status: 405,
      headers: {
        Allow: allowHead ? [...allowed, "HEAD"].join(", ") : allowed.join(", "),
      },
    });
  }
}

/**
 * Get the request hostname.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If no host header is found, it will return an empty string.
 *
 * **Security:** The returned host reflects the client-supplied `Host` (or
 * `X-Forwarded-Host`) header and can be spoofed. Do not trust it for security
 * decisions (CSRF/origin checks, cache keys, generating absolute links sent to
 * other users) unless the `Host` value is pinned or validated upstream (e.g. an
 * allow-list of expected hosts, or a reverse proxy that overwrites it).
 *
 * @example
 * app.get("/", (event) => {
 *   const host = getRequestHost(event); // "example.com"
 * });
 */
export function getRequestHost(event: HTTPEvent, opts: { xForwardedHost?: boolean } = {}): string {
  if (opts.xForwardedHost) {
    const _header = event.req.headers.get("x-forwarded-host");
    const xForwardedHost = (_header || "").split(",").shift()?.trim();
    if (xForwardedHost) {
      return xForwardedHost;
    }
  }
  return event.req.headers.get("host") || "";
}

/**
 * Get the request protocol.
 *
 * If `xForwardedProto` is `true`, it will use the `x-forwarded-proto` header if it exists. When the header contains a comma-separated list of protocols, the first entry is used.
 *
 * Note: This header is opt-in (default `false`) since it can be spoofed by clients. Only enable it when your application runs behind a trusted reverse proxy or CDN that sets this header. This default was changed to match `getRequestHost` (`xForwardedHost`) and `getRequestIP` (`xForwardedFor`).
 *
 * If protocol cannot be determined, it will default to "http".
 *
 * @example
 * app.get("/", (event) => {
 *   const protocol = getRequestProtocol(event); // "https"
 * });
 */
export function getRequestProtocol(
  event: HTTPEvent | H3Event,
  opts: { xForwardedProto?: boolean } = {},
): "http" | "https" | (string & {}) {
  if (opts.xForwardedProto) {
    const _header = event.req.headers.get("x-forwarded-proto");
    const forwardedProto = (_header || "").split(",")[0].trim();
    if (forwardedProto === "https") {
      return "https";
    }
    if (forwardedProto === "http") {
      return "http";
    }
  }
  const url = (event as H3Event).url || new URL(event.req.url);
  return url.protocol.slice(0, -1);
}

/**
 * Generated the full incoming request URL.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If `xForwardedProto` is `true`, it will use the `x-forwarded-proto` header if it exists.
 *
 * **Security:** The `.origin` and `.host` of the returned URL are derived from the
 * client-supplied `Host` (or `X-Forwarded-Host`) header and can be spoofed. Do not
 * trust them for security decisions (CSRF/origin checks, cache keys, generating
 * absolute links sent to other users) unless the `Host` value is pinned or
 * validated upstream (e.g. an allow-list of expected hosts, or a reverse proxy
 * that overwrites it). The `.pathname` and `.search` are not derived from the
 * spoofable host, but remain untrusted client input — validate or encode them for
 * their eventual sink (e.g. filesystem lookups, HTML output, downstream queries).
 *
 * @example
 * app.get("/", (event) => {
 *   const url = getRequestURL(event); // "https://example.com/path"
 * });
 */
export function getRequestURL(
  event: HTTPEvent | H3Event,
  opts: { xForwardedHost?: boolean; xForwardedProto?: boolean } = {},
): URL {
  const url = new URL((event as H3Event).url || event.req.url);
  url.protocol = getRequestProtocol(event, opts);
  if (opts.xForwardedHost) {
    const host = getRequestHost(event, opts);
    if (host) {
      url.host = host;
      if (!/:\d+$/.test(host)) {
        url.port = "";
      }
    }
  }
  return url;
}

/**
 * Try to get the client IP address from the incoming request.
 *
 * If `xForwardedFor` is `true`, it will use the `x-forwarded-for` header if it exists.
 *
 * If IP cannot be determined, it will default to `undefined`.
 *
 * @example
 * app.get("/", (event) => {
 *   const ip = getRequestIP(event); // "192.0.2.0"
 * });
 */
export function getRequestIP(
  event: HTTPEvent,
  opts: {
    /**
     * Use the X-Forwarded-For HTTP header set by proxies.
     *
     * Note: Make sure that this header can be trusted (your application running behind a CDN or reverse proxy) before enabling.
     */
    xForwardedFor?: boolean;
  } = {},
): string | undefined {
  if (opts.xForwardedFor) {
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For#syntax
    const _header = event.req.headers.get("x-forwarded-for");
    if (_header) {
      const xForwardedFor = _header.split(",")[0].trim();
      if (xForwardedFor) {
        return xForwardedFor;
      }
    }
  }

  return (event.req.context?.clientAddress as string) || event.req.ip || undefined;
}
