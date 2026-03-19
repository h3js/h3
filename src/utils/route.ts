import type { H3RouteMeta, HTTPMethod } from "../types/h3.ts";
import type { EventHandler, Middleware } from "../types/handler.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import { removeRoute as _removeRoute } from "rou3";
import { defineValidatedHandler } from "../handler.ts";

/**
 * Route definition options
 */
export interface RouteDefinition {
  /**
   * HTTP method for the route, e.g. 'GET', 'POST', etc.
   */
  method: HTTPMethod;

  /**
   * Route pattern, e.g. '/api/users/:id'
   */
  route: string;

  /**
   * Handler function for the route.
   */
  handler: EventHandler;

  /**
   * Optional middleware to run before the handler.
   */
  middleware?: Middleware[];

  /**
   * Additional route metadata.
   */
  meta?: H3RouteMeta;

  // Validation schemas
  // TODO: Support generics for better typing `handler` input
  validate?: {
    body?: StandardSchemaV1;
    headers?: StandardSchemaV1;
    query?: StandardSchemaV1;
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
 *    method: 'POST',
 *    validate: {
 *      query: z.object({ id: z.string().uuid() }),
 *      body: z.object({ name: z.string() }),
 *    },
 *    handler: (event) => {
 *      return { success: true };
 *    }
 * });
 *
 * app.register(userRoute);
 * ```
 */
export function defineRoute(def: RouteDefinition): H3Plugin {
  const handler = defineValidatedHandler(def) as any;
  return (h3: H3) => {
    h3.on(def.method, def.route, handler);
  };
}

/**
 * Remove a route handler from the app.
 *
 * @example
 * ```ts
 * import { H3, removeRoute } from "h3";
 *
 * const app = new H3();
 * app.get("/temp", () => "hello");
 *
 * removeRoute(app, "GET", "/temp"); // route removed
 * ```
 */
export function removeRoute(
  app: H3,
  method: HTTPMethod | Lowercase<HTTPMethod> | "",
  route: string,
): void {
  const _method = method ? method.toUpperCase() : undefined;
  route = new URL(route, "http://_").pathname;
  _removeRoute(app["~rou3"], _method || "", route);
  const idx = app["~routes"].findIndex(
    (r) => r.route === route && (_method == null || r.method === _method),
  );
  if (idx !== -1) {
    app["~routes"].splice(idx, 1);
  }
}
