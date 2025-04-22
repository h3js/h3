import type { HTTPMethod } from "..";

export interface H3CorsOptions {
  /**
   * This determines the value of the "access-control-allow-origin" response header.
   * If "*", it can be used to allow all origins.
   * If an array of strings or regular expressions, it can be used with origin matching.
   * If a custom function, it's used to validate the origin. It takes the origin as an argument and returns `true` if allowed.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin
   * @default "*"
   */
  origin?: "*" | "null" | (string | RegExp)[] | ((origin: string) => boolean);
  /**
   * This determines the value of the "access-control-allow-methods" response header of a preflight request.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Methods
   * @default "*"
   * @example ["GET", "HEAD", "PUT", "POST"]
   */
  methods?: "*" | HTTPMethod[];
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
  preflight?: {
    statusCode?: number;
  };
}

// TODO: Define `ResolvedCorsOptions` as "deep required nonnullable" type of `CorsOptions`
export interface H3ResolvedCorsOptions {
  origin: "*" | "null" | (string | RegExp)[] | ((origin: string) => boolean);
  methods: "*" | HTTPMethod[];
  allowHeaders: "*" | string[];
  exposeHeaders: "*" | string[];
  credentials: boolean;
  maxAge: string | false;
  preflight: {
    statusCode: number;
  };
}

export type H3EmptyHeader = Record<string, never>;

export type H3AccessControlAllowOriginHeader =
  | {
      "access-control-allow-origin": "*";
    }
  | {
      "access-control-allow-origin": "null" | string;
      vary: "origin";
    }
  | H3EmptyHeader;

export type H3AccessControlAllowMethodsHeader =
  | {
      "access-control-allow-methods": "*" | string;
    }
  | H3EmptyHeader;

export type H3AccessControlAllowCredentialsHeader =
  | {
      "access-control-allow-credentials": "true";
    }
  | H3EmptyHeader;

export type H3AccessControlAllowHeadersHeader =
  | {
      "access-control-allow-headers": "*" | string;
      vary: "access-control-request-headers";
    }
  | H3EmptyHeader;

export type H3AccessControlExposeHeadersHeader =
  | {
      "access-control-expose-headers": "*" | string;
    }
  | H3EmptyHeader;

export type H3AccessControlMaxAgeHeader =
  | {
      "access-control-max-age": string;
    }
  | H3EmptyHeader;

export type H3CorsHeaders =
  | H3AccessControlAllowOriginHeader
  | H3AccessControlAllowMethodsHeader
  | H3AccessControlAllowCredentialsHeader
  | H3AccessControlAllowHeadersHeader
  | H3AccessControlExposeHeadersHeader
  | H3AccessControlMaxAgeHeader;
