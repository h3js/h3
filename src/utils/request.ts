import { createError } from "../error.ts";
import { parseQuery } from "./internal/query.ts";
import { validateData, type ValidateFunction } from "./internal/validate.ts";

import type { H3Event } from "../types/event.ts";
import type { InferEventInput } from "../types/handler.ts";
import type { HTTPMethod } from "../types/h3.ts";

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
  Event extends H3Event = H3Event,
  _T = Exclude<InferEventInput<"query", Event, T>, undefined>,
>(event: Event): _T {
  return parseQuery(event.url.search.slice(1)) as _T;
}

/**
 * Get the query param from the request URL validated with validate function.
 *
 * You can use a simple function to validate the query object or a library like `zod` to define a schema.
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
 *     }).parse,
 *   );
 * });
 */
export function getValidatedQuery<
  T,
  Event extends H3Event = H3Event,
  _T = InferEventInput<"query", Event, T>,
>(event: Event, validate: ValidateFunction<_T>): Promise<_T> {
  const query = getQuery(event);
  return validateData(query, validate);
}

/**
 * Get matched route params.
 *
 * If `decode` option is `true`, it will decode the matched route params using `decodeURIComponent`.
 *
 * @example
 * app.get("/", (event) => {
 *   const params = getRouterParams(event); // { key: "value" }
 * });
 */
export function getRouterParams(
  event: H3Event,
  opts: { decode?: boolean } = {},
): NonNullable<H3Event["context"]["params"]> {
  // Fallback object needs to be returned in case router is not used (#149)
  let params = event.context.params || {};
  if (opts.decode) {
    params = { ...params };
    for (const key in params) {
      params[key] = decodeURIComponent(params[key]);
    }
  }
  return params;
}

/**
 * Get matched route params and validate with validate function.
 *
 * If `decode` option is `true`, it will decode the matched route params using `decodeURI`.
 *
 * You can use a simple function to validate the params object or a library like `zod` to define a schema.
 *
 * @example
 * app.get("/", async (event) => {
 *   const params = await getValidatedRouterParams(event, (data) => {
 *     return "key" in data && typeof data.key === "string";
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * app.get("/", async (event) => {
 *   const params = await getValidatedRouterParams(
 *     event,
 *     z.object({
 *       key: z.string(),
 *     }).parse,
 *   );
 * });
 */
export function getValidatedRouterParams<
  T,
  Event extends H3Event = H3Event,
  _T = InferEventInput<"routerParams", Event, T>,
>(
  event: Event,
  validate: ValidateFunction<_T>,
  opts: { decode?: boolean } = {},
): Promise<_T> {
  const routerParams = getRouterParams(event, opts);
  return validateData(routerParams, validate);
}

/**
 * Get a matched route param by name.
 *
 * If `decode` option is `true`, it will decode the matched route param using `decodeURI`.
 *
 * @example
 * app.get("/", (event) => {
 *   const param = getRouterParam(event, "key");
 * });
 */
export function getRouterParam(
  event: H3Event,
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
  event: H3Event,
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
 * If the method is not allowed, it will throw a 405 error with the message "HTTP method is not allowed".
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
  event: H3Event,
  expected: HTTPMethod | HTTPMethod[],
  allowHead?: boolean,
): void {
  if (!isMethod(event, expected, allowHead)) {
    throw createError({
      statusCode: 405,
      statusMessage: "HTTP method is not allowed.",
    });
  }
}

/**
 * Get the request hostname.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If no host header is found, it will default to "localhost".
 *
 * @example
 * app.get("/", (event) => {
 *   const host = getRequestHost(event); // "example.com"
 * });
 */
export function getRequestHost(
  event: H3Event,
  opts: { xForwardedHost?: boolean } = {},
): string {
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
 * If `x-forwarded-proto` header is set to "https", it will return "https". You can disable this behavior by setting `xForwardedProto` to `false`.
 *
 * If protocol cannot be determined, it will default to "http".
 *
 * @example
 * app.get("/", (event) => {
 *   const protocol = getRequestProtocol(event); // "https"
 * });
 */
export function getRequestProtocol(
  event: H3Event,
  opts: { xForwardedProto?: boolean } = {},
): "http" | "https" | (string & {}) {
  if (opts.xForwardedProto !== false) {
    const forwardedProto = event.req.headers.get("x-forwarded-proto");
    if (forwardedProto === "https") {
      return "https";
    }
    if (forwardedProto === "http") {
      return "http";
    }
  }
  return event.url.protocol.slice(0, -1);
}

/**
 * Generated the full incoming request URL.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If `xForwardedProto` is `false`, it will not use the `x-forwarded-proto` header.
 *
 * @example
 * app.get("/", (event) => {
 *   const url = getRequestURL(event); // "https://example.com/path"
 * });
 */
export function getRequestURL(
  event: H3Event,
  opts: { xForwardedHost?: boolean; xForwardedProto?: boolean } = {},
): URL {
  const url = new URL(event.url);
  url.protocol = getRequestProtocol(event, opts);
  if (opts.xForwardedHost) {
    const host = getRequestHost(event, opts);
    if (host) {
      url.host = host;
      if (!host.includes(":")) {
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
  event: H3Event,
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
    const xForwardedFor = (_header || "")?.split(",").shift()?.trim();
    if (xForwardedFor) {
      return xForwardedFor;
    }
  }

  return event.context.clientAddress || event.req.ip || undefined;
}
