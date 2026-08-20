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
 * for WebSocket upgrade requests, with the resolved hooks attached as `crossws`.
 *
 * Convenience only: hooks are handed to adapters on the *request*
 * (`Symbol.for("crossws.hooks")`), because a `Response` is rebuilt whenever
 * anything stages a response header on the way out and a rebuild carries none of
 * the original's own properties. Read `crossws` off a response only when nothing
 * in the app can have touched it; `getWebSocketHooks(request)` from crossws is
 * the reliable read.
 *
 * `crossws` is always the resolved hooks object: when the handler is defined
 * with an async hooks factory, `defineWebSocketHandler()` awaits it before
 * attaching it.
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
      return crossws.then((resolved) => toUpgradeResponse(event, resolved));
    }

    return toUpgradeResponse(event, crossws);
  });
}

/**
 * Check whether the incoming request is a WebSocket upgrade request.
 */
function isWebSocketUpgrade(event: H3Event): boolean {
  return event.req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * crossws' registry-symbol channel for handing hooks off on the *request*.
 *
 * `Symbol.for("crossws.hooks")` is crossws' documented wire format (its own
 * `setWebSocketHooks()` writes this exact key), so writing it needs no import and
 * keeps crossws a types-only optional peer dependency, across duplicate module
 * instances and realms.
 */
const kWebSocketHooks: unique symbol = /* @__PURE__ */ Symbol.for("crossws.hooks");

/**
 * Build the `426 Upgrade Required` response and hand the resolved hooks to
 * crossws.
 *
 * The request is the channel that matters: a `Response` is rebuilt whenever
 * anything stages a response header on the way out (a `headers` route rule,
 * CORS), or by any layer doing `new Response(res.body, res)`, and a rebuild
 * carries none of the original's own properties — hooks attached to a response
 * disappear silently, leaving the route answering an opaque `426`. Nothing
 * replaces the request, so writing them there always reaches the resolver.
 *
 * `crossws` is still set on the response: crossws prefers it when present, and
 * it keeps `app.fetch()` self-describing for tests and custom resolvers. It is
 * best-effort, not the contract.
 */
function toUpgradeResponse(event: H3Event, crossws: Partial<WebSocketHooks>): WebSocketResponse {
  try {
    const req = event.req as unknown as Record<symbol, unknown> & {
      context?: Record<symbol, unknown>;
    };
    if (req.context) {
      req.context[kWebSocketHooks] = crossws;
    }
    req[kWebSocketHooks] = crossws;
  } catch {
    // A non-extensible request would *throw* here (ESM is strict mode), which
    // would fail the upgrade outright instead of just losing the hooks. Not
    // reachable through `H3Event` (its constructor already writes `req.context`),
    // but a handler can also be invoked directly with a bare event.
  }
  return Object.assign(new Response("WebSocket upgrade is required.", { status: 426 }), {
    crossws,
  });
}
