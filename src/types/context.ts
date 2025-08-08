import type { Session } from "../utils/session.ts";
import type { H3Route, H3RouteMeta } from "./h3.ts";

export interface H3EventContext extends Record<string, any> {
  /* Matched router parameters */
  params?: Record<string, string>;

  /* Matched middleware parameters */
  middlewareParams?: Record<string, string>;

  /**
   * Matched router Node
   *
   * @experimental The object structure may change in non-major version.
   */
  matchedRoute?: H3Route;

  /**
   * Matched middleware with their metadata
   *
   * @experimental The object structure may change in non-major version.
   */
  matchedMiddleware?: Array<{
    route?: string;
    meta?: H3RouteMeta;
  }>;

  /* Cached session data */
  sessions?: Record<string, Session>;

  /* Trusted IP Address of client */
  clientAddress?: string;

  /* Basic authentication data */
  basicAuth?: {
    username?: string;
    password?: string;
    realm?: string;
  };
}
