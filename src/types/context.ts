import type { Session } from "../utils/session.ts";
import type { H3Route } from "./h3.ts";
import type { RouteRules } from "./route-rules.ts";
import type { ServerRequestContext } from "srvx";

export interface H3EventContext extends ServerRequestContext {
  /* Matched router parameters (typed/coerced when validated) */
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
}

/**
 * Typed view over {@link H3EventContext} with specific fields replaced.
 *
 * Overridden keys become required and fully typed (e.g. schema-coerced params in
 * `defineValidatedHandler`); every other field — including `declare module`
 * augmentations — keeps its base type. The mapped form (instead of `Omit`)
 * preserves literal keys next to `ServerRequestContext`'s index signature.
 */
export type TypedH3EventContext<Overrides = {}> = {
  [K in keyof H3EventContext as K extends keyof Overrides ? never : K]: H3EventContext[K];
} & Overrides;
