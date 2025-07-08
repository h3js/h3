import type { HTTPMethod } from "../types/h3.ts";
import type { Middleware } from "../types/handler.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { H3Event } from "../event.ts";
import { defineMiddleware } from "../middleware.ts";

/**
 * Middleware route definition options
 */
export interface MiddlewareRouteDefinition {
  /**
   * Path pattern for the middleware, e.g. '/api/**'
   */
  path?: string;

  /**
   * HTTP methods to apply the middleware to
   */
  methods?: HTTPMethod[];

  /**
   * Middleware handler function
   */
  handler: Middleware;

  /**
   * Additional middleware metadata
   */
  meta?: Record<string, unknown>;
}

/**
 * Define a middleware route as a plugin that can be registered with app.register()
 *
 * @example
 * ```js
 * const authMiddleware = defineMiddlewareRoute({
 *   path: '/api/**',
 *   methods: ['GET', 'POST'],
 *   meta: {
 *     rateLimit: {
 *       interval: '1m',
 *       tokensPerInterval: 10,
 *     },
 *   },
 *   handler: async (event, next) => {
 *     console.log('Auth middleware running');
 *     // Check authentication
 *     if (!event.context.user) {
 *       return new Response('Unauthorized', { status: 401 });
 *     }
 *     return next();
 *   }
 * });
 *
 * app.register(authMiddleware);
 * ```
 */
export function defineMiddlewareRoute(
  def: MiddlewareRouteDefinition,
): H3Plugin {
  const middleware = defineMiddleware(def.handler);

  return (h3: H3) => {
    const options = {
      ...(def.methods && {
        match: (event: H3Event) => {
          const method = event.req.method.toUpperCase();
          return def.methods!.includes(method as HTTPMethod);
        },
      }),
      ...(def.meta && { meta: def.meta }),
    };

    if (def.path) {
      h3.use(def.path, middleware, options);
    } else {
      h3.use(middleware, options);
    }
  };
}
