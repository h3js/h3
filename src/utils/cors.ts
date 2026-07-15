import type { H3Event, HTTPEvent } from "../event.ts";
import { noContent } from "./response.ts";
import {
  createAllowHeaderHeaders,
  createCredentialsHeaders,
  createExposeHeaders,
  createMaxAgeHeader,
  createMethodsHeaders,
  createOriginHeaders,
  resolveCorsOptions,
} from "./internal/cors.ts";
import type { HTTPResponse } from "../response.ts";

export { isCorsOriginAllowed } from "./internal/cors.ts";

export interface CorsOptions {
  /**
   * This determines the value of the "access-control-allow-origin" response header.
   * If "*", it can be used to allow all origins.
   * If an array of strings or regular expressions, it can be used with origin matching.
   * If a custom function, it's used to validate the origin. It takes the origin as an argument and returns `true` if allowed.
   *
   * Avoid `"null"` together with `credentials: true`. Sandboxed iframes, `data:`/`file:` documents,
   * and other opaque origins all send `Origin: null`, so allowing it with credentials would share
   * them across untrusted contexts.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin
   * @default "*"
   */
  origin?: "*" | "null" | (string | RegExp)[] | ((origin: string) => boolean);

  /**
   * This determines the value of the "access-control-allow-methods" response header of a preflight request.
   *
   * The default `"*"` permits any method (including non-safelisted ones like `QUERY`).
   * When using an explicit allowlist, remember that `QUERY` is **not** a CORS-safelisted
   * method, so browsers preflight it — include `"QUERY"` in the array to allow it.
   *
   * When `credentials` is enabled, browsers treat `"*"` as a literal method name — in that
   * case the requested method is reflected back instead of sending a literal `*`.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Methods
   * @default "*"
   * @example ["GET", "HEAD", "PUT", "POST", "QUERY"]
   */
  methods?: "*" | string[];

  /**
   * This determines the value of the "access-control-allow-headers" response header of a preflight request.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Headers
   * @default "*"
   */
  allowHeaders?: "*" | string[];

  /**
   * This determines the value of the "access-control-expose-headers" response header.
   *
   * When `credentials` is enabled, browsers treat `"*"` as a literal header name — in that
   * case the header is omitted; list the headers explicitly to expose them.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers
   * @default "*"
   */
  exposeHeaders?: "*" | string[];

  /**
   * This determines the value of the "access-control-allow-credentials" response header.
   * When request with credentials, the options that `origin`, `methods`, `exposeHeaders` and `allowHeaders` should not be set "*".
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials
   * @see https://fetch.spec.whatwg.org/#cors-protocol-and-credentials
   * @default false
   */
  credentials?: boolean;

  /**
   * This determines the value of the "access-control-max-age" response header of a preflight request.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
   * @default false
   */
  maxAge?: string | false;

  /**
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Headers
   */
  preflight?: {
    statusCode?: number;
  };
}

/**
 * Check if the incoming request is a CORS preflight request.
 */
export function isPreflightRequest(event: HTTPEvent): boolean {
  const origin = event.req.headers.get("origin");
  const accessControlRequestMethod = event.req.headers.get("access-control-request-method");

  return event.req.method === "OPTIONS" && !!origin && !!accessControlRequestMethod;
}

/**
 * Append CORS preflight headers to the response.
 */
export function appendCorsPreflightHeaders(event: H3Event, options: CorsOptions): void {
  const headerGroups = [
    createOriginHeaders(event, options),
    createCredentialsHeaders(options),
    createMethodsHeaders(event, options),
    createAllowHeaderHeaders(event, options),
    createMaxAgeHeader(options),
  ];
  // Several groups can independently emit a `vary` key. Plain spread would keep
  // only the last one — merge them so none is lost.
  const headers: Record<string, string> = Object.assign({}, ...headerGroups);
  const varyValues = headerGroups.map((group) => group.vary).filter(Boolean);
  if (varyValues.length > 0) {
    headers.vary = varyValues.join(", ");
  }
  setCorsHeaders(event, headers);
}

/**
 * Append CORS headers to the response.
 */
export function appendCorsHeaders(event: H3Event, options: CorsOptions): void {
  const headers = {
    ...createOriginHeaders(event, options),
    ...createCredentialsHeaders(options),
    ...createExposeHeaders(options),
  };
  setCorsHeaders(event, headers);
}

/**
 * Apply CORS response headers.
 *
 * CORS headers are single-valued, so use `.set` to avoid invalid duplicated
 * values (e.g. `*, *`) when CORS is applied more than once (middleware + handler).
 * The `vary` header is legitimately multi-valued and is appended instead.
 */
function setCorsHeaders(event: H3Event, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (key === "vary") {
      event.res.headers.append(key, value);
      event.res.errHeaders.append(key, value);
    } else {
      event.res.headers.set(key, value);
      event.res.errHeaders.set(key, value);
    }
  }
}

/**
 * Handle CORS for the incoming request.
 *
 * If the incoming request is a CORS preflight request, it will append the CORS preflight headers and send a 204 response.
 *
 * If return value is not `false`, the request is handled and no further action is needed.
 *
 * @example
 * const app = new H3();
 * app.all("/", async (event) => {
 *   const corsRes = handleCors(event, {
 *     origin: "*",
 *     preflight: {
 *       statusCode: 204,
 *     },
 *     methods: "*",
 *   });
 *   if (corsRes !== false) {
 *     return corsRes;
 *   }
 *   // Your code here
 * });
 */
export function handleCors(event: H3Event, options: CorsOptions): false | HTTPResponse {
  const _options = resolveCorsOptions(options);
  if (isPreflightRequest(event)) {
    appendCorsPreflightHeaders(event, _options);
    return noContent(_options.preflight.statusCode);
  }
  appendCorsHeaders(event, _options);
  return false;
}
