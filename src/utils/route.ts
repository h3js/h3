import type { HTTPMethod } from "../types/h3.ts";
import type { EventHandler, Middleware } from "../types/handler.ts";
import type { H3Event } from "../event.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import { defineHandler } from "../handler.ts";
import { getValidatedQuery, getValidatedRouterParams } from "./request.ts";
import { readValidatedBody } from "./body.ts";

/**
 * Route definition interface with h3 integration
 * Compatible with h3's RouteOptions and meta system
 */
export interface RouteDefinition {
  method: HTTPMethod;
  route: string;
  routerParams?: StandardSchemaV1;
  queryParams?: StandardSchemaV1;
  input?: StandardSchemaV1;
  output?: StandardSchemaV1;
  handler: (event: H3Event) => any;
  middleware?: Middleware[];
}

/**
 * Define a route handler with optional validation and meta/middleware.
 * Returns an EventHandler ready to use with app.on().
 *
 * The handler's .meta property will include routeParams, queryParams, input, output, and method/route info.
 *
 * @example
 * ```js
 * app.on('GET', '/foo', defineRoute({
 *   handler: (event) => 'ok',
 *   input: z.object({ ... }),
 *   middleware: [ ... ]
 * }))
 * ```
 */
export function defineRoute(
  config: Omit<RouteDefinition, "method" | "route"> & {
    method?: HTTPMethod;
    route?: string;
  },
): EventHandler {
  const handler = defineHandler({
    handler: async (event: H3Event) => {
      if (config.input) {
        await readValidatedBody(event, config.input);
      }
      if (config.queryParams) {
        await getValidatedQuery(event, config.queryParams);
      }
      if (config.routerParams) {
        await getValidatedRouterParams(event, config.routerParams);
      }
      return await config.handler(event);
    },
    middleware: config.middleware,
  });
  // Attach meta info for introspection (not for user input)
  handler.meta = {
    routerParams: config.routerParams,
    queryParams: config.queryParams,
    input: config.input,
    output: config.output,
    method: config.method,
    route: config.route,
  };
  return handler;
}
