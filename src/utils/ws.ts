import { defineHandler } from "../handler.ts";

import type { Hooks as WebSocketHooks } from "crossws";
import type { H3Event } from "../event.ts";
import type { EventHandler, EventHandlerRequest, EventHandlerResponse } from "../types/handler.ts";

export type {
  Hooks as WebSocketHooks,
  Message as WebSocketMessage,
  Peer as WebSocketPeer,
} from "crossws";

/**
 * The `426 Upgrade Required` response returned by `defineWebSocketHandler()`
 * for WebSocket upgrade requests, augmented with the `crossws` hooks that
 * were attached to it. Adapters (like the crossws `serve()` plugin) read
 * `crossws` off this response to wire up the platform-specific WebSocket
 * upgrade.
 *
 * `crossws` is always the resolved hooks object: when the handler is defined
 * with an async hooks factory, `defineWebSocketHandler()` awaits it before
 * attaching it to the response.
 */
export type WebSocketResponse = Response & { crossws?: Partial<WebSocketHooks> };

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

export function defineWebSocketHandler(
  hooks: Partial<WebSocketHooks>,
): EventHandler<EventHandlerRequest, WebSocketResponse>;
export function defineWebSocketHandler(
  hooks: (event: H3Event) => Partial<WebSocketHooks> | Promise<Partial<WebSocketHooks>>,
): EventHandler<EventHandlerRequest, EventHandlerResponse<WebSocketResponse>>;
export function defineWebSocketHandler<Http extends EventHandler>(
  hooks: Partial<WebSocketHooks>,
  http: Http,
): EventHandler<EventHandlerRequest, WebSocketResponse | ReturnType<Http>>;
export function defineWebSocketHandler<Http extends EventHandler>(
  hooks: (event: H3Event) => Partial<WebSocketHooks> | Promise<Partial<WebSocketHooks>>,
  http: Http,
): EventHandler<EventHandlerRequest, EventHandlerResponse<WebSocketResponse> | ReturnType<Http>>;
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

    // Async hook factories must be awaited before `crossws` is attached,
    // otherwise the response ends up carrying an unresolved Promise instead
    // of the hooks object. Sync hooks stay on the sync path (no wrapping).
    if (crossws instanceof Promise) {
      return crossws.then(toUpgradeResponse);
    }

    return toUpgradeResponse(crossws);
  });
}

/**
 * Check whether the incoming request is a WebSocket upgrade request.
 */
function isWebSocketUpgrade(event: H3Event): boolean {
  return event.req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * Build the `426 Upgrade Required` response, with the resolved `crossws`
 * hooks attached for adapters to read.
 */
function toUpgradeResponse(crossws: Partial<WebSocketHooks>): WebSocketResponse {
  return Object.assign(new Response("WebSocket upgrade is required.", { status: 426 }), {
    crossws,
  });
}
