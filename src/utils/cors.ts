import type { H3Event } from "../types/event.ts";
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

export { isCorsOriginAllowed } from "./internal/cors.ts";

export interface CorsOptions {
  origin?: "*" | "null" | (string | RegExp)[] | ((origin: string) => boolean);
  methods?: "*" | string[];
  allowHeaders?: "*" | string[];
  exposeHeaders?: "*" | string[];
  credentials?: boolean;
  maxAge?: string | false;
  preflight?: {
    statusCode?: number;
  };
}

/**
 * Check if the incoming request is a CORS preflight request.
 */
export function isPreflightRequest(event: H3Event): boolean {
  const origin = event.req.headers.get("origin");
  const accessControlRequestMethod = event.req.headers.get(
    "access-control-request-method",
  );

  return (
    event.req.method === "OPTIONS" && !!origin && !!accessControlRequestMethod
  );
}

/**
 * Append CORS preflight headers to the response.
 */
export function appendCorsPreflightHeaders(
  event: H3Event,
  options: CorsOptions,
): void {
  const headers = {
    ...createOriginHeaders(event, options),
    ...createCredentialsHeaders(options),
    ...createMethodsHeaders(options),
    ...createAllowHeaderHeaders(event, options),
    ...createMaxAgeHeader(options),
  };
  for (const [key, value] of Object.entries(headers)) {
    event.res.headers.append(key, value);
  }
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
  for (const [key, value] of Object.entries(headers)) {
    event.res.headers.append(key, value);
  }
}

/**
 * Handle CORS for the incoming request.
 *
 * If the incoming request is a CORS preflight request, it will append the CORS preflight headers and send a 204 response.
 *
 * If return value is `true`, the request is handled and no further action is needed.
 *
 * @example
 * const app = new H3();
 * const router = createRouter();
 * router.use("/", async (event) => {
 *   const corsRes = handleCors(event, {
 *     origin: "*",
 *     preflight: {
 *       statusCode: 204,
 *     },
 *     methods: "*",
 *   });
 *   if (corsRes) {
 *     return corsRes;
 *   }
 *   // Your code here
 * });
 */
export function handleCors(event: H3Event, options: CorsOptions): false | "" {
  const _options = resolveCorsOptions(options);
  if (isPreflightRequest(event)) {
    appendCorsPreflightHeaders(event, options);
    return noContent(event, _options.preflight.statusCode);
  }
  appendCorsHeaders(event, options);
  return false;
}
