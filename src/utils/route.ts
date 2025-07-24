import type { HTTPMethod } from "../types/h3.ts";
import type { EventHandler, Middleware } from "../types/handler.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { StandardSchemaV1 } from "./internal/standard-schema.ts";
import type { Hooks as WSHooks } from "crossws";
import { defineValidatedHandler } from "../handler.ts";
import { defineWebSocketHandler } from "./ws.ts";

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
  meta?: Record<string, unknown>;

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
 * WebSocket route definition options
 */
export interface WebSocketRouteDefinition {
  /**
   * HTTP method for the route (typically 'GET' for WebSocket upgrades)
   */
  method?: HTTPMethod;

  /**
   * Route pattern, e.g. '/api/ws'
   */
  route: string;

  /**
   * WebSocket hooks
   */
  websocket: Partial<WSHooks>;

  /**
   * Optional middleware to run before WebSocket upgrade
   */
  middleware?: Middleware[];

  /**
   * Additional route metadata
   */
  meta?: Record<string, unknown>;
}

/**
 * Define a WebSocket route as a plugin that can be registered with app.register()
 *
 * @example
 * ```js
 * const wsRoute = defineWebSocketRoute({
 *   route: '/api/ws',
 *   websocket: {
 *     open: (peer) => {
 *       console.log('WebSocket connected:', peer.id);
 *       peer.send('Welcome!');
 *     },
 *     message: (peer, message) => {
 *       console.log('Received:', message);
 *       peer.send(`Echo: ${message}`);
 *     },
 *     close: (peer) => {
 *       console.log('WebSocket closed:', peer.id);
 *     }
 *   }
 * });
 *
 * app.register(wsRoute);
 * ```
 */
export function defineWebSocketRoute(def: WebSocketRouteDefinition): H3Plugin {
  const handler = defineWebSocketHandler(def.websocket);
  return (h3: H3) => {
    h3.on(def.method || "GET", def.route, handler);
  };
}
