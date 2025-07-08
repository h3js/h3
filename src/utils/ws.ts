import { defineHandler } from "../handler.ts";

import type { Hooks as WSHooks } from "crossws";
import type { EventHandler } from "../types/handler.ts";

/**
 * Define WebSocket hooks.
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocket(hooks: Partial<WSHooks>): Partial<WSHooks> {
  return hooks;
}

/**
 * Define WebSocket event handler.
 *
 * @see https://h3.dev/guide/websocket
 */
export function defineWebSocketHandler(hooks: Partial<WSHooks>): EventHandler {
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
