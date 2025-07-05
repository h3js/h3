import type { HTTPMethod } from "../types/h3.ts";
import type { Middleware } from "../types/handler.ts";
import type { H3Event } from "../event.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import { defineValidatedHandler } from "../handler.ts";
import { getValidatedRouterParams } from "./request.ts";
import { validateData } from "./internal/validate.ts";

/**
 * Route definition options
 */
export interface RouteDefinition {
  method: HTTPMethod;
  route: string;
  handler: (event: H3Event) => any;
  middleware?: Middleware[];
  meta?: Record<string, unknown>;
  validation?: {
    params?: StandardSchemaV1;
    query?: StandardSchemaV1;
    body?: StandardSchemaV1;
    response?: StandardSchemaV1;
  };
}

/**
 * Define a route as a plugin that can be registered with app.register()
 *
 * @example
 * ```js
 * import { z } from "zod";
 *
 * const userRoute = defineRoute({
 *   method: 'POST',
 *   route: '/api/users/:id',
 *   validation: {
 *     params: z.object({ id: z.string().uuid() }),
 *     body: z.object({ name: z.string() }),
 *     response: z.object({ success: z.boolean() })
 *   },
 *   handler: (event) => {
 *     return { success: true };
 *   }
 * });
 *
 * app.register(userRoute);
 * ```
 */
export function defineRoute(config: RouteDefinition): H3Plugin {
  return (h3: H3) => {
    const { validation, middleware, handler: userHandler } = config;

    // Create base handler function with conditional output validation
    const createBaseHandler = (baseHandler: (event: H3Event) => any) => {
      // Early exit if no response validation needed
      if (!validation?.response) {
        return baseHandler;
      }

      return async (event: H3Event) => {
        const result = await baseHandler(event);
        return await validateData(result, validation.response!);
      };
    };

    // Determine if body/query validation is needed
    const bodySchema = validation?.body;
    const querySchema = validation?.query;
    const needsValidation = bodySchema || querySchema;

    // Create base handler with optional router params validation
    const baseHandler = createBaseHandler(async (event: H3Event) => {
      if (validation?.params) {
        await getValidatedRouterParams(event, validation.params);
      }
      return await userHandler(event);
    });

    // Dynamically construct validated handler
    const handler = defineValidatedHandler({
      middleware,
      ...(needsValidation && { body: bodySchema }),
      ...(needsValidation && { query: querySchema }),
      handler: baseHandler,
    }) as any;

    // Attach meta info
    handler.meta = {
      ...config.meta,
      method: config.method,
      route: config.route,
      validation,
    };

    // Register the route
    h3.on(config.method, config.route, handler);
  };
}
