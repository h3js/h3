import { getQuery as _getQuery, decode as decodeURI } from "ufo";
import { createError } from "../error";
import type {
  HTTPHeaderName,
  HTTPMethod,
  InferEventInput,
  RequestHeaders,
} from "../types";
import type { H3Event } from "../event";
import { validateData, ValidateFunction } from "./internal/validate";
import { getRequestWebStream } from "./body";

/**
 * Get the query params object from the request URL parsed with [unjs/ufo](https://ufo.unjs.io).
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const query = getQuery(event); // { key: "value", key2: ["value1", "value2"] }
 * });
 */
export function getQuery<
  T,
  Event extends H3Event = H3Event,
  _T = Exclude<InferEventInput<"query", Event, T>, undefined>,
>(event: Event): _T {
  return _getQuery(event.path || "") as _T;
}

/**
 * Get the query params object from the request URL parsed with [unjs/ufo](https://ufo.unjs.io) and validated with validate function.
 *
 * You can use a simple function to validate the query object or a library like `zod` to define a schema.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const query = getValidatedQuery(event, (data) => {
 *     return "key" in data && typeof data.key === "string";
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * export default defineEventHandler((event) => {
 *   const query = getValidatedQuery(
 *     event,
 *     z.object({
 *       key: z.string(),
 *     }),
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
 * If `decode` option is `true`, it will decode the matched route params using `decodeURI`.
 *
 * @example
 * export default defineEventHandler((event) => {
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
      params[key] = decodeURI(params[key]);
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
 * export default defineEventHandler((event) => {
 *   const params = getValidatedRouterParams(event, (data) => {
 *     return "key" in data && typeof data.key === "string";
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * export default defineEventHandler((event) => {
 *   const params = getValidatedRouterParams(
 *     event,
 *     z.object({
 *       key: z.string(),
 *     }),
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
 * export default defineEventHandler((event) => {
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
 * @deprecated Directly use `event.method` instead.
 */
export function getMethod(
  event: H3Event,
  defaultMethod: HTTPMethod = "GET",
): HTTPMethod {
  return (event.node.req.method || defaultMethod).toUpperCase() as HTTPMethod;
}

/**
 *
 * Checks if the incoming request method is of the expected type.
 *
 * If `allowHead` is `true`, it will allow `HEAD` requests to pass if the expected method is `GET`.
 *
 * @example
 * export default defineEventHandler((event) => {
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
) {
  if (allowHead && event.method === "HEAD") {
    return true;
  }

  if (typeof expected === "string") {
    if (event.method === expected) {
      return true;
    }
  } else if (expected.includes(event.method)) {
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
 * export default defineEventHandler((event) => {
 *   assertMethod(event, "GET");
 *   // Handle GET request, otherwise throw 405 error
 * });
 */
export function assertMethod(
  event: H3Event,
  expected: HTTPMethod | HTTPMethod[],
  allowHead?: boolean,
) {
  if (!isMethod(event, expected, allowHead)) {
    throw createError({
      statusCode: 405,
      statusMessage: "HTTP method is not allowed.",
    });
  }
}

/**
 * Get the request headers object.
 *
 * Array headers are joined with a comma.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const headers = getRequestHeaders(event); // { "content-type": "application/json", "x-custom-header": "value" }
 * });
 */
export function getRequestHeaders(event: H3Event): RequestHeaders {
  const _headers: RequestHeaders = {};
  for (const key in event.node.req.headers) {
    const val = event.node.req.headers[key];
    _headers[key] = Array.isArray(val) ? val.filter(Boolean).join(", ") : val;
  }
  return _headers;
}

/**
 * Alias for `getRequestHeaders`.
 */
export const getHeaders = getRequestHeaders;

/**
 * Get a request header by name.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const contentType = getRequestHeader(event, "content-type"); // "application/json"
 * });
 */
export function getRequestHeader(
  event: H3Event,
  name: HTTPHeaderName,
): RequestHeaders[string] {
  const headers = getRequestHeaders(event);
  const value = headers[name.toLowerCase()];
  return value;
}

/**
 * Alias for `getRequestHeader`.
 */
export const getHeader = getRequestHeader;

/**
 * Get the request hostname.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If no host header is found, it will default to "localhost".
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const host = getRequestHost(event); // "example.com"
 * });
 */
export function getRequestHost(
  event: H3Event,
  opts: { xForwardedHost?: boolean } = {},
) {
  if (opts.xForwardedHost) {
    const _header = event.node.req.headers["x-forwarded-host"] as
      | string
      | undefined;
    const xForwardedHost = (_header || "").split(",").shift()?.trim();
    if (xForwardedHost) {
      return xForwardedHost;
    }
  }
  return event.node.req.headers.host || "localhost";
}

/**
 * Get the request protocol.
 *
 * If `x-forwarded-proto` header is set to "https", it will return "https". You can disable this behavior by setting `xForwardedProto` to `false`.
 *
 * If protocol cannot be determined, it will default to "http".
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const protocol = getRequestProtocol(event); // "https"
 * });
 */
export function getRequestProtocol(
  event: H3Event,
  opts: { xForwardedProto?: boolean } = {},
) {
  if (
    opts.xForwardedProto !== false &&
    event.node.req.headers["x-forwarded-proto"] === "https"
  ) {
    return "https";
  }
  return (event.node.req.connection as any)?.encrypted ? "https" : "http";
}

const DOUBLE_SLASH_RE = /[/\\]{2,}/g;

/** @deprecated Use `event.path` instead */
export function getRequestPath(event: H3Event): string {
  const path = (event.node.req.url || "/").replace(DOUBLE_SLASH_RE, "/");
  return path;
}

/**
 * Generate the full incoming request URL using `getRequestProtocol`, `getRequestHost` and `event.path`.
 *
 * If `xForwardedHost` is `true`, it will use the `x-forwarded-host` header if it exists.
 *
 * If `xForwardedProto` is `false`, it will not use the `x-forwarded-proto` header.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const url = getRequestURL(event); // "https://example.com/path"
 * });
 */
export function getRequestURL(
  event: H3Event,
  opts: { xForwardedHost?: boolean; xForwardedProto?: boolean } = {},
) {
  const host = getRequestHost(event, opts);
  const protocol = getRequestProtocol(event, opts);
  const path = (event.node.req.originalUrl || event.path).replace(
    /^[/\\]+/g,
    "/",
  );
  return new URL(path, `${protocol}://${host}`);
}

/**
 * Convert the H3Event to a WebRequest object.
 *
 * **NOTE:** This function is not stable and might have edge cases that are not handled properly.
 */
export function toWebRequest(event: H3Event) {
  let abortSignal: AbortController | undefined;

  return (
    event.web?.request ||
    new Request(getRequestURL(event), {
      // @ts-ignore Undici option
      duplex: "half",
      method: event.method,
      headers: event.headers,
      body: getRequestWebStream(event),
      get signal() {
        if (!abortSignal) {
          abortSignal = new AbortController();

          const abort = (err?: any) => abortSignal?.abort(err);
          event.node.req.once("close", abort);
          event.node.req.once("end", abort);
        }
        return abortSignal.signal;
      },
    })
  );
}

/**
 * Try to get the client IP address from the incoming request.
 *
 * If `xForwardedFor` is `true`, it will use the `x-forwarded-for` header set by proxies if it exists.
 *
 * Note: Make sure that this header can be trusted (your application running behind a CDN or reverse proxy) before enabling.
 *
 * If IP cannot be determined, it will default to `undefined`.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const ip = getRequestIP(event); // "192.0.2.0"
 * });
 */
export function getRequestIP(
  event: H3Event,
  opts: { xForwardedFor?: boolean } = {},
): string | undefined {
  if (event.context.clientAddress) {
    return event.context.clientAddress;
  }

  if (opts.xForwardedFor) {
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For#syntax
    const xForwardedFor = getRequestHeader(event, "x-forwarded-for")
      ?.split(",")
      .shift()
      ?.trim();
    if (xForwardedFor) {
      return xForwardedFor;
    }
  }

  if (event.node.req.socket.remoteAddress) {
    return event.node.req.socket.remoteAddress;
  }
}
