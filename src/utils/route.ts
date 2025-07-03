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
  validation?: {
    routerParams?: boolean;
    queryParams?: boolean;
    input?: boolean;
    output?: boolean;
  };
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
 *   validation: {
 *     queryParams: true,
 *     output: false // Skip output validation
 *   },
 *   handler: (event) => ({ users: [] })
 * });
 *
 * app.register(userRoutePlugin);
 * ```
 */
export function defineRoute(config: RouteDefinition): H3Plugin {
  return (h3: H3) => {
    // Default validation settings - enable all by default
    const validationConfig = {
      routerParams: true,
      queryParams: true,
      input: true,
      output: true,
      ...config.validation,
    };

    // Create base handler function with conditional output validation
    const createBaseHandler = (baseHandler: (event: H3Event) => any) => {
      if (config.output && validationConfig.output) {
        return async (event: H3Event) => {
          const result = await baseHandler(event);
          // Validate response against output schema
          return await validateData(result, config.output!);
        };
      }
      return baseHandler;
    };

    // Determine which schemas to use for validation based on config
    const bodySchema =
      config.input && validationConfig.input ? config.input : undefined;
    const querySchema =
      config.queryParams && validationConfig.queryParams
        ? config.queryParams
        : undefined;

    // Create handler with conditional validation using defineValidatedHandler
    const handler: EventHandler =
      bodySchema || querySchema
        ? (defineValidatedHandler({
            middleware: config.middleware,
            body: bodySchema,
            query: querySchema,
            handler: createBaseHandler(async (event: H3Event) => {
              // Handle routerParams validation separately if enabled
              if (config.routerParams && validationConfig.routerParams) {
                await getValidatedRouterParams(event, config.routerParams);
              }
              return await config.handler(event);
            }),
          }) as unknown as EventHandler)
        : (defineValidatedHandler({
            middleware: config.middleware,
            handler: createBaseHandler(async (event: H3Event) => {
              if (config.routerParams && validationConfig.routerParams) {
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
      validation: validationConfig,
      method: config.method,
      route: config.route,
      ...config.meta,
    };

    // Register the route with the h3 instance
    h3.on(config.method, config.route, handler);
  };
}
