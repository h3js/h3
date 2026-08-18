import { type ErrorDetails, HTTPError } from "../error.ts";
import { decodePreservingSeparators, stripBase } from "./internal/path.ts";
import { EmptyObject } from "./internal/obj.ts";
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
  // Null prototype: with a plain object literal every `Object.prototype` key is
  // a cache hit, so `constructor` would resolve to `Object` and `__proto__` to
  // `Object.prototype` instead of the request's own.
  const cache: Record<string | symbol, unknown> = new EmptyObject();
  cache.url = url;
  // Shadow `_url` too: the runtime-parsed URL object reflects the original
  // request URL and consumers must re-parse the overridden `url` instead.
  cache._url = undefined;
  return new Proxy(req, {
    get(target, prop) {
      if (prop in cache) return cache[prop];
      const value = Reflect.get(target, prop);
      // Never memoize `bodyUsed`: it flips when the body is consumed.
      if (prop === "bodyUsed") return value;
      // Methods are bound so they run against the real request (private field
      // brand checks), but `constructor` has to keep its identity for
      // `req.constructor === Request` style duck-typing.
      cache[prop] =
        typeof value === "function" && prop !== "constructor" ? value.bind(target) : value;
      return cache[prop];
    },
    set(target, prop, value) {
      // Writes go to the request, so drop the stale memo (except the shadowed url).
      if (prop !== "url" && prop !== "_url") delete cache[prop];
      return Reflect.set(target, prop, value);
    },
  });
}

/**
 * Create a lightweight request proxy with the base path stripped from the URL pathname.
 *
 * `options.url` is the parsed request URL to strip `base` from, in place of
 * parsing `req.url`. Pass `event.url` whenever there is an event: for a
 * non-canonical path it holds the canonicalized form the parent matched `base`
 * against, while `req.url` still holds the wire form, and slicing one by an
 * offset derived from the other is how mount prefixes desync.
 */
export function requestWithBaseURL(
  req: ServerRequest,
  base: string,
  options: { url?: URL } = {},
): ServerRequest {
  // Strip only, never decode: the mounted handler must receive the same
  // representation the parent app routed on.
  const url = new URL(options.url || req.url);
  url.pathname = stripBase(url.pathname, base);
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
 * By default params are returned exactly as they appeared in the URL path, still
 * percent-encoded.
 *
 * With `decode: true` each param is decoded **once** (like `decodeURIComponent`),
 * except encoded path separators (`%2f`, `%5c`, at any `%25`-nesting depth) which
 * are left in their encoded form so decoding can never reintroduce a `/` or `\`
 * the router never matched.
 *
 * A single decode is not the same as "fully decoded": `%25XX` decodes to the
 * literal text `%XX`, so the result can still contain percent-escapes — including
 * dot segments (`%252e%252e` -> `%2e%2e`) and control characters (`%2500` -> `%00`).
 * **Do not decode the result again**: a second pass turns those back into
 * traversal (`../`) and separators the routing and middleware layers never saw.
 * Treat the returned string as final and validate it as-is.
 *
 * @example
 * app.get("/", (event) => {
 *   const params = getRouterParams(event); // { key: "value" }
 * });
 *
 * @example
 * // GET /files/%252e%252e/x
 * app.get("/files/**:rest", (event) => {
 *   getRouterParams(event); // { rest: "%252e%252e/x" }
 *   getRouterParams(event, { decode: true }); // { rest: "%2e%2e/x" } — still encoded, do not decode again
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
      // Never let an encoded separator collapse into a raw `/` or `\`: whatever
      // reaches a param survived the `decodeURI` in `event.ts` still encoded, so
      // route matching and every pathname-based middleware only ever saw it as
      // one opaque segment (a `:id` capture can never hold a raw separator).
      // Decoding it here would reintroduce a separator — and `..`-based
      // traversal — that no guard could see.
      params[key] = decodePreservingSeparators(params[key]);
    }
  }
  return params;
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
 * If `decode` option is `true`, params are decoded **once** exactly as described in
 * {@link getRouterParams} — path separators stay encoded, other escapes decode a
 * single level, and the validated value can still contain `%XX`. Validate it as-is;
 * do not decode it again.
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
  // `expected` is typed uppercase, but a request method arrives as sent:
  // `new Request()` only normalizes the fetch spec's fixed token list
  // (DELETE/GET/HEAD/OPTIONS/POST/PUT), so `patch` stays `patch`. Comparing raw
  // would report a mismatch for a method the request actually used.
  const method = event.req.method.toUpperCase();

  if (allowHead && method === "HEAD") {
    return true;
  }

  if (typeof expected === "string") {
    if (method === expected) {
      return true;
    }
  } else if (expected.includes(method as HTTPMethod)) {
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
      applyForwardedHost(url, host);
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

// --- internal ---

/**
 * Apply a client provided `hostname[:port]` to `url`.
 *
 * The URL `hostname` and `port` setters silently ignore invalid values, so both
 * are checked before they are trusted: applying a malformed host as-is would
 * leave the real authority half rewritten (a bad hostname keeping the real port
 * or, worse, a spoofed hostname inheriting it).
 */
function applyForwardedHost(url: URL, host: string): void {
  const sep = host.lastIndexOf(":");
  const hasPort = sep > host.lastIndexOf("]"); // ignore the colons of an [ipv6] host
  const hostname = hasPort ? host.slice(0, sep) : host;
  const prevHostname = url.hostname;
  url.hostname = hostname;
  if (url.hostname === prevHostname && hostname.toLowerCase() !== prevHostname) {
    return; // the setter was a no-op: keep the real authority
  }
  const port = hasPort ? host.slice(sep + 1) : "";
  url.port = /^\d{1,5}$/.test(port) && +port < 65_536 ? port : "";
}
