import type { Session } from "../utils/session.ts";
import type { H3Route } from "./h3.ts";
import type { RouteRules } from "./route-rules.ts";
import type { ServerRequestContext } from "srvx";

export interface H3EventContext extends ServerRequestContext {
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

  /* Cached session data */
  sessions?: Record<string, Session>;

  /* Rules matched for the current route */
  routeRules?: Readonly<RouteRules>;

  /* Trusted IP Address of client */
  clientAddress?: string;

  /* Basic authentication data */
  basicAuth?: {
    username?: string;
    password?: string;
    realm?: string;
  };

  /* Server-Timing entries collected via setServerTiming / withServerTiming */
  timing?: Array<{ name: string } & Record<string, unknown>>;

  /* Request id assigned by the requestId middleware */
  requestId?: string;
}
