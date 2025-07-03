import type { HTTPMethod } from "../types/h3.ts";
import type { EventHandler, Middleware } from "../types/handler.ts";
import type { H3Event } from "../event.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import { defineValidatedHandler } from "../handler.ts";
import { getValidatedRouterParams } from "./request.ts";
import { validateData } from "./internal/validate.ts";

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
  meta?: Record<string, unknown>;
}

/**
 * Define a route plugin that automatically registers a route with validation.
 * Returns an H3Plugin that can be registered with app.register().
 *
 * This provides a structured approach to route definition with optional type safety,
 * validation, and seamless h3 integration.
 *
 * @example
 * ```js
 * const userRoutePlugin = defineRoute({
 *   method: 'GET',
 *   route: '/api/users',
 *   queryParams: z.object({ page: z.string().optional() }),
 *   output: z.object({ users: z.array(z.object({ id: z.string() })) }),
 *   handler: (event) => ({ users: [] })
 * });
 *
 * app.register(userRoutePlugin);
 * ```
 */
export function defineRoute(config: RouteDefinition): H3Plugin {
  return (h3: H3) => {
    // Create base handler function with output validation if specified
    const createBaseHandler = (baseHandler: (event: H3Event) => any) => {
      if (config.output) {
        return async (event: H3Event) => {
          const result = await baseHandler(event);
          // Validate response against output schema
          return await validateData(result, config.output!);
        };
      }
      return baseHandler;
    };

    // Create handler with validation using defineValidatedHandler
    const handler: EventHandler =
      config.input || config.queryParams
        ? (defineValidatedHandler({
            middleware: config.middleware,
            body: config.input,
            query: config.queryParams,
            handler: createBaseHandler(async (event: H3Event) => {
              // Handle routerParams validation separately as it's not supported by defineValidatedHandler
              if (config.routerParams) {
                await getValidatedRouterParams(event, config.routerParams);
              }
              return await config.handler(event);
            }),
          }) as unknown as EventHandler)
        : (defineValidatedHandler({
            middleware: config.middleware,
            handler: createBaseHandler(async (event: H3Event) => {
              if (config.routerParams) {
                await getValidatedRouterParams(event, config.routerParams);
              }
              return await config.handler(event);
            }),
          }) as unknown as EventHandler);

    // Attach meta info for introspection
    handler.meta = {
      routerParams: config.routerParams,
      queryParams: config.queryParams,
      input: config.input,
      output: config.output,
      method: config.method,
      route: config.route,
      ...config.meta,
    };

    // Register the route with the h3 instance
    h3.on(config.method, config.route, handler);
  };
}
