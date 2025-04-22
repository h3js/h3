import type { H3Event } from "../../types";
import type {
  H3CorsOptions,
  H3ResolvedCorsOptions,
  H3AccessControlAllowOriginHeader,
  H3AccessControlAllowMethodsHeader,
  H3AccessControlAllowCredentialsHeader,
  H3AccessControlAllowHeadersHeader,
  H3AccessControlExposeHeadersHeader,
  H3AccessControlMaxAgeHeader,
} from "../../types/utils/cors";

/**
 * Resolve CORS options.
 */
export function resolveCorsOptions(
  options: H3CorsOptions = {},
): H3ResolvedCorsOptions {
  const defaultOptions: H3ResolvedCorsOptions = {
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

  return {
    ...defaultOptions,
    ...options,
    preflight: {
      ...defaultOptions.preflight,
      ...options.preflight,
    },
  };
}

/**
 * Check if the origin is allowed.
 */
export function isCorsOriginAllowed(
  origin: string | null | undefined,
  options: H3CorsOptions,
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
export function createOriginHeaders(
  event: H3Event,
  options: H3CorsOptions,
): H3AccessControlAllowOriginHeader {
  const { origin: originOption } = options;
  const origin = event.req.headers.get("origin");

  if (!originOption || originOption === "*") {
    return { "access-control-allow-origin": "*" };
  }

  if (originOption === "null") {
    return { "access-control-allow-origin": "null", vary: "origin" };
  }

  if (isCorsOriginAllowed(origin, options)) {
    return { "access-control-allow-origin": origin!, vary: "origin" };
  }

  return {};
}

/**
 * Create the `access-control-allow-methods` header.
 */
export function createMethodsHeaders(
  options: H3CorsOptions,
): H3AccessControlAllowMethodsHeader {
  const { methods } = options;

  if (!methods) {
    return {};
  }

  if (methods === "*") {
    return { "access-control-allow-methods": "*" };
  }

  return methods.length > 0
    ? { "access-control-allow-methods": methods.join(",") }
    : {};
}

/**
 * Create the `access-control-allow-credentials` header.
 */
export function createCredentialsHeaders(
  options: H3CorsOptions,
): H3AccessControlAllowCredentialsHeader {
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
  options: H3CorsOptions,
): H3AccessControlAllowHeadersHeader {
  const { allowHeaders } = options;

  if (!allowHeaders || allowHeaders === "*" || allowHeaders.length === 0) {
    const header = event.req.headers.get("access-control-request-headers");

    return header
      ? {
          "access-control-allow-headers": header,
          vary: "access-control-request-headers",
        }
      : {};
  }

  return {
    "access-control-allow-headers": allowHeaders.join(","),
    vary: "access-control-request-headers",
  };
}

/**
 * Create the `access-control-expose-headers` header.
 */
export function createExposeHeaders(
  options: H3CorsOptions,
): H3AccessControlExposeHeadersHeader {
  const { exposeHeaders } = options;

  if (!exposeHeaders) {
    return {};
  }

  if (exposeHeaders === "*") {
    return { "access-control-expose-headers": exposeHeaders };
  }

  return { "access-control-expose-headers": exposeHeaders.join(",") };
}

/**
 * Create the `access-control-max-age` header.
 */
export function createMaxAgeHeader(
  options: H3CorsOptions,
): H3AccessControlMaxAgeHeader {
  const { maxAge } = options;

  if (maxAge) {
    return { "access-control-max-age": maxAge };
  }

  return {};
}
