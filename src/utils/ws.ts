import { createError } from "../error.ts";
import { defineEventHandler } from "../handler.ts";

import type { Hooks as WSHooks } from "crossws";
import type { EventHandler } from "../types/handler.ts";

/**
 * Define WebSocket hooks.
 *
 * @see https://h3.unjs.io/guide/websocket
 */
export function defineWebSocket(hooks: Partial<WSHooks>): Partial<WSHooks> {
  return hooks;
}

/**
 * Define WebSocket event handler.
 *
 * @see https://h3.unjs.io/guide/websocket
 */
export function defineWebSocketHandler(hooks: Partial<WSHooks>): EventHandler {
  return defineEventHandler({
    handler() {
      throw createError({
        statusCode: 426,
        statusMessage: "Upgrade Required",
      });
    },
    websocket: hooks,
  });
}
