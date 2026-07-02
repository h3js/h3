import { defineHandler } from "../handler.ts";

import type { Hooks as WebSocketHooks } from "crossws";
import type { H3Event } from "../event.ts";
import type { EventHandler } from "../types/handler.ts";

export type {
  Hooks as WebSocketHooks,
  Message as WebSocketMessage,
  Peer as WebSocketPeer,
} from "crossws";

/**
 * Define WebSocket hooks.
 *
 * @example
 * const hooks = defineWebSocket({
 *   open: (peer) => peer.send("Welcome!"),
 *   message: (peer, message) => peer.send(message.text()),
 *   close: (peer) => console.log("closed", peer),
 * });
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocket(hooks: Partial<WebSocketHooks>): Partial<WebSocketHooks> {
  return hooks;
}

/**
 * Define WebSocket event handler.
 *
 * By default, non-upgrade (plain HTTP) requests receive a `426 Upgrade Required`
 * response. Pass an `http` handler to serve those requests instead, allowing the
 * same route to handle both WebSocket upgrades and regular HTTP requests.
 * WebSocket upgrade requests always go to `hooks`.
 *
 * Note: the `http` handler only handles non-upgrade requests. To reject or
 * customize the upgrade handshake itself, use the crossws `upgrade` hook instead.
 *
 * @example
 * // WebSocket-only route (non-upgrade requests get `426 Upgrade Required`)
 * app.get("/_ws", defineWebSocketHandler({
 *   message: (peer, message) => peer.send(message.text()),
 * }));
 *
 * @example
 * // Handle both WebSocket upgrades and plain HTTP on the same route
 * app.get("/_ws", defineWebSocketHandler(
 *   { message: (peer, message) => peer.send(message.text()) },
 *   () => "Send a WebSocket upgrade request to connect.",
 * ));
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocketHandler(
  hooks:
    | Partial<WebSocketHooks>
    | ((event: H3Event) => Partial<WebSocketHooks> | Promise<Partial<WebSocketHooks>>),
  http?: EventHandler,
): EventHandler {
  return defineHandler(function _webSocketHandler(event) {
    if (http && !isWebSocketUpgrade(event)) {
      return http(event);
    }

    const crossws = typeof hooks === "function" ? hooks(event) : hooks;

    return Object.assign(
      new Response("WebSocket upgrade is required.", {
        status: 426,
      }),
      {
        crossws,
      },
    );
  });
}

/**
 * Check whether the incoming request is a WebSocket upgrade request.
 */
function isWebSocketUpgrade(event: H3Event): boolean {
  return event.req.headers.get("upgrade")?.toLowerCase() === "websocket";
}
