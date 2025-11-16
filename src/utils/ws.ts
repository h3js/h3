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
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocket(
  hooks: Partial<WebSocketHooks>,
): Partial<WebSocketHooks> {
  return hooks;
}

/**
 * Define WebSocket event handler.
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocketHandler(
  hooks:
    | Partial<WebSocketHooks>
    | ((event: H3Event) => Partial<WebSocketHooks>),
): EventHandler {
  return defineHandler(function _webSocketHandler(event) {
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
