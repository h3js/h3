import type { H3Route, H3RouteMeta, HTTPMethod } from "../types/h3.ts";
import type { EventHandler, Middleware } from "../types/handler.ts";
import type { H3 } from "../types/h3.ts";
import type { H3Plugin } from "../plugin.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import { addRoute, createRouter, removeRoute as _removeRoute } from "rou3";
import { defineValidatedHandler } from "../handler.ts";
import { normalizeRoute } from "./internal/path.ts";

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
 * All registrations matching `method` + `route` are removed (an empty `method`
 * only matches routes registered with `app.all()`).
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
  const _method = (method ? method.toUpperCase() : "") as HTTPMethod;
  route = normalizeRoute(route);

  const routes = app["~routes"];
  const kept = routes.filter((r) => !(r.route === route && (r.method || "") === _method));
  if (kept.length === routes.length) {
    // Nothing mirrored in `~routes`: only the router may have it (e.g. a route
    // added straight to `~rou3`).
    _removeRoute(app["~rou3"], _method, route);
    return;
  }
  app["~routes"] = kept;

  // Every registration reaching the same rou3 node shares one `node.methods[method]`
  // array and rou3 drops the whole array, so removing `/users/:id` would unregister
  // `/users/:name` too (and `/a` would take the `/a` expansion of `/a/{b}?` with it).
  // Rebuilding from the surviving `~routes` removes exactly what was matched above
  // and keeps both views in sync — `~routes` is what `mount()` copies and `tracing`
  // rewrites, so a stale entry resurrects a removed route in the parent app.
  const rou3 = app["~rou3"];
  if (rou3) {
    const rebuilt = createRouter<H3Route>();
    for (const r of kept) {
      addRoute(rebuilt, r.method || "", r.route!, r);
    }
    // In place: `~rou3` identity may be held elsewhere.
    rou3.root = rebuilt.root;
    rou3.static = rebuilt.static;
  }
}
