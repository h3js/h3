import { defineHandler } from "../handler.ts";

import type { Hooks as WebSocketHooks } from "crossws";
import type { EventHandler } from "../types/handler.ts";

export type { 
  Hooks as WebSocketHooks,
  Peer as WebSocketPeer,
  AdapterInternal as WebSocketAdapterInteral,
  Message as WebSocketMessage 
} from "crossws";

/**
 * Define WebSocket hooks.
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocket(hooks: Partial<WebSocketHooks>): Partial<WebSocketHooks> {
  return hooks;
}

/**
 * Define WebSocket event handler.
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocketHandler(hooks: Partial<WebSocketHooks>): EventHandler {
  return defineHandler(() => {
    return Object.assign(
      new Response("WebSocket upgrade is required.", {
        status: 426,
      }),
      {
        crossws: hooks,
      },
    );
  });
}
