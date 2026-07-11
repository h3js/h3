import type { H3Event } from "../../event.ts";
import type { CorsOptions } from "../cors.ts";

interface ResolvedCorsOptions {
  origin: "*" | "null" | (string | RegExp)[] | ((origin: string) => boolean);
  methods: "*" | string[];
  allowHeaders: "*" | string[];
  exposeHeaders: "*" | string[];
  credentials: boolean;
  maxAge: string | false;
  preflight: {
    statusCode: number;
  };
}

/**
 * Resolve CORS options.
 */
export function resolveCorsOptions(options: CorsOptions = {}): ResolvedCorsOptions {
  const defaultOptions: ResolvedCorsOptions = {
    origin: "*",
    methods: "*",
    allowHeaders: "*",
    exposeHeaders: "*",
    credentials: false,
    maxAge: false,
    preflight: {
      statusCode: 204,
    },
  };

  const resolved = {
    ...defaultOptions,
    ...options,
    preflight: {
      ...defaultOptions.preflight,
      ...options.preflight,
    },
  };

  if (resolved.credentials && (!options.origin || options.origin === "*")) {
    console.warn(
      "[h3] CORS: `credentials: true` with wildcard origin is not allowed. Browsers will reject the response.",
    );
  }

  if (resolved.credentials && options.exposeHeaders === "*") {
    console.warn(
      "[h3] CORS: `credentials: true` with wildcard `exposeHeaders` has no effect. Browsers treat `*` literally on credentialed requests — list the headers explicitly.",
    );
  }

  return resolved;
}

/**
 * Check if the origin is allowed.
 */
export function isCorsOriginAllowed(
  origin: string | null | undefined,
  options: CorsOptions,
): boolean {
  const { origin: originOption } = options;

  if (!origin) {
    return false;
  }

  if (!originOption || originOption === "*") {
    return true;
  }

  if (typeof originOption === "function") {
    return originOption(origin);
  }

  if (Array.isArray(originOption)) {
    return originOption.some((_origin) => {
      if (_origin instanceof RegExp) {
        return _origin.test(origin);
      }

      return origin === _origin;
    });
  }

  return originOption === origin;
}

/**
 * Create the `access-control-allow-origin` header.
 */
export function createOriginHeaders(event: H3Event, options: CorsOptions): Record<string, string> {
  const { origin: originOption } = options;
  const origin = event.req.headers.get("origin");

  if (!originOption || originOption === "*") {
    return { "access-control-allow-origin": "*" };
  }

  if (isCorsOriginAllowed(origin, options)) {
    return { "access-control-allow-origin": origin!, vary: "origin" };
  }

  // The response depends on the request origin even when it is rejected —
  // without `vary: origin` a shared cache could serve this response to an allowed origin.
  return { vary: "origin" };
}

/**
 * Create the `access-control-allow-methods` header.
 */
export function createMethodsHeaders(event: H3Event, options: CorsOptions): Record<string, string> {
  const { methods, credentials } = options;

  if (!methods) {
    return {};
  }

  if (methods === "*") {
    if (credentials) {
      // Browsers treat `*` literally on credentialed requests — reflect the requested method instead
      const requestMethod = event.req.headers.get("access-control-request-method");
      return requestMethod
        ? {
            "access-control-allow-methods": requestMethod,
            vary: "access-control-request-method",
          }
        : {};
    }
    return { "access-control-allow-methods": "*" };
  }

  return methods.length > 0 ? { "access-control-allow-methods": methods.join(",") } : {};
}

/**
 * Create the `access-control-allow-credentials` header.
 */
export function createCredentialsHeaders(options: CorsOptions): Record<string, string> {
  const { credentials } = options;

  if (credentials) {
    return { "access-control-allow-credentials": "true" };
  }

  return {};
}

/**
 * Create the `access-control-allow-headers` and `vary` headers.
 */
export function createAllowHeaderHeaders(
  event: H3Event,
  options: CorsOptions,
): Record<string, string> {
  const { allowHeaders } = options;

  if (!allowHeaders || allowHeaders === "*" || allowHeaders.length === 0) {
    const header = event.req.headers.get("access-control-request-headers");

    // The response reflects the request header, so declare the variance
    // even when the header is absent.
    return header
      ? {
          "access-control-allow-headers": header,
          vary: "access-control-request-headers",
        }
      : { vary: "access-control-request-headers" };
  }

  return {
    "access-control-allow-headers": allowHeaders.join(","),
    vary: "access-control-request-headers",
  };
}

/**
 * Create the `access-control-expose-headers` header.
 */
export function createExposeHeaders(options: CorsOptions): Record<string, string> {
  const { exposeHeaders, credentials } = options;

  if (!exposeHeaders) {
    return {};
  }

  if (exposeHeaders === "*") {
    // Browsers treat `*` literally on credentialed requests — omit the useless header
    return credentials ? {} : { "access-control-expose-headers": exposeHeaders };
  }

  return { "access-control-expose-headers": exposeHeaders.join(",") };
}

/**
 * Create the `access-control-max-age` header.
 */
export function createMaxAgeHeader(options: CorsOptions): Record<string, string> {
  const { maxAge } = options;

  if (maxAge) {
    return { "access-control-max-age": maxAge };
  }

  return {};
}
