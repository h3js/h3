import type { EventHandler, EventHandlerObject, EventHandlerRequest } from "../types/handler.ts";
import type { Hooks as WebSocketHooks, Peer as WebSocketPeer } from "crossws";
import type { H3Event } from "../event.ts";
import { defineHandler } from "../handler.ts";
import { defineWebSocketHandler } from "./ws.ts";
import { HTTPError } from "../error.ts";
import { HTTPResponse } from "../response.ts";

/**
 * JSON-RPC 2.0 Interfaces based on the specification.
 * https://www.jsonrpc.org/specification
 */

/**
 * JSON-RPC 2.0 params.
 */
export type JsonRpcParams = Record<string, unknown> | unknown[];

/**
 * JSON-RPC 2.0 Request object.
 */
export interface JsonRpcRequest<I extends JsonRpcParams | undefined = JsonRpcParams | undefined> {
  jsonrpc: "2.0";
  method: string;
  params?: I;
  id?: string | number | null;
}

/**
 * JSON-RPC 2.0 Error object.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/**
 * JSON-RPC 2.0 Response object.
 */
export type JsonRpcResponse<O = unknown> =
  | { jsonrpc: "2.0"; id: string | number | null; result: O }
  | { jsonrpc: "2.0"; id: string | number | null; error: JsonRpcError };

/**
 * A function that handles a JSON-RPC method call.
 * It receives the parameters from the request and the original H3Event.
 */
export type JsonRpcMethod<
  O = unknown,
  I extends JsonRpcParams | undefined = JsonRpcParams | undefined,
> = (data: JsonRpcRequest<I>, event: H3Event) => O | Promise<O>;

/**
 * A function that handles a JSON-RPC method call over WebSocket.
 * It receives the parameters from the request and the WebSocket peer.
 */
export type JsonRpcWebSocketMethod<
  O = unknown,
  I extends JsonRpcParams | undefined = JsonRpcParams | undefined,
> = (data: JsonRpcRequest<I>, peer: WebSocketPeer) => O | Promise<O>;

const PARSE_ERROR = -32_700; // Invalid JSON was received by the server.
const INVALID_REQUEST = -32_600; // The JSON sent is not a valid Request object.
const METHOD_NOT_FOUND = -32_601; // The method does not exist / is not available.
const INVALID_PARAMS = -32_602; // Invalid method parameter(s).

/**
 * Creates an H3 event handler that implements the JSON-RPC 2.0 specification.
 *
 * @param methods A map of RPC method names to their handler functions.
 * @param middleware Optional middleware to apply to the handler.
 * @returns An H3 EventHandler.
 *
 * @example
 * app.post("/rpc", defineJsonRpcHandler({
 *   methods: {
 *     echo: ({ params }, event) => {
 *       return `Received \`${params}\` on path \`${event.url.pathname}\``;
 *     },
 *     sum: ({ params }, event) => {
 *       return params.a + params.b;
 *     },
 *   },
 * }));
 */
export function defineJsonRpcHandler<RequestT extends EventHandlerRequest = EventHandlerRequest>(
  opts: Omit<EventHandlerObject<RequestT>, "handler" | "fetch"> & {
    methods: Record<string, JsonRpcMethod>;
  } = {} as any,
): EventHandler<RequestT> {
  const methodMap = createMethodMap(opts.methods);
  const handler = async (event: H3Event) => {
    // JSON-RPC requests MUST be POST.
    if (event.req.method !== "POST") {
      throw new HTTPError({ status: 405 });
    }
    let body: unknown;
    try {
      body = await event.req.json();
    } catch {
      return createJsonRpcError(null, PARSE_ERROR, "Parse error");
    }
    const result = await processJsonRpcBody(body, methodMap, event);
    return result === undefined ? new HTTPResponse("", { status: 202 }) : result;
  };
  return defineHandler<RequestT>({ ...opts, handler });
}

/**
 * Creates an H3 event handler that implements JSON-RPC 2.0 over WebSocket.
 *
 * This is an opt-in feature that allows JSON-RPC communication over WebSocket
 * connections for bi-directional messaging. Each incoming WebSocket text message
 * is processed as a JSON-RPC request, and responses are sent back to the peer.
 *
 * @param opts Options including methods map and optional WebSocket hooks.
 * @returns An H3 EventHandler that upgrades to a WebSocket connection.
 *
 * @example
 * app.get("/rpc/ws", defineJsonRpcWebSocketHandler({
 *   methods: {
 *     echo: ({ params }) => {
 *       return `Received: ${Array.isArray(params) ? params[0] : params?.message}`;
 *     },
 *     sum: ({ params }) => {
 *       return params.a + params.b;
 *     },
 *   },
 * }));
 *
 * @example
 * // With additional WebSocket hooks
 * app.get("/rpc/ws", defineJsonRpcWebSocketHandler({
 *   methods: {
 *     greet: ({ params }) => `Hello, ${params.name}!`,
 *   },
 *   hooks: {
 *     open(peer) {
 *       console.log(`Peer connected: ${peer.id}`);
 *     },
 *     close(peer, details) {
 *       console.log(`Peer disconnected: ${peer.id}`, details);
 *     },
 *   },
 * }));
 */
export function defineJsonRpcWebSocketHandler(opts: {
  methods: Record<string, JsonRpcWebSocketMethod>;
  hooks?: Partial<Omit<WebSocketHooks, "message">>;
}): EventHandler {
  const methodMap = createMethodMap(opts.methods);
  return defineWebSocketHandler({
    ...opts.hooks,
    async message(peer, message) {
      let body: unknown;
      try {
        body = message.json();
      } catch {
        peer.send(JSON.stringify(createJsonRpcError(null, PARSE_ERROR, "Parse error")));
        return;
      }
      const result = await processJsonRpcBody(body, methodMap, peer);
      if (result !== undefined) {
        peer.send(JSON.stringify(result));
      }
    },
  });
}

// --- Internal shared helpers ---

/**
 * Build a null-prototype lookup map to prevent prototype pollution.
 * This ensures that method names like "__proto__", "constructor", "toString",
 * "hasOwnProperty", etc. cannot resolve to inherited Object.prototype properties.
 */
function createMethodMap<T extends JsonRpcMethod | JsonRpcWebSocketMethod>(
  methods: Record<string, T>,
): Record<string, T> {
  const methodMap: Record<string, T> = Object.create(null);
  for (const key of Object.keys(methods)) {
    methodMap[key] = methods[key];
  }
  return methodMap;
}

/**
 * Validates and processes a parsed JSON-RPC body (single or batch).
 *
 * @returns The JSON-RPC response(s) to send, or `undefined` if all requests were notifications.
 */
async function processJsonRpcBody<C extends H3Event | WebSocketPeer>(
  body: unknown,
  methodMap: Record<string, (data: JsonRpcRequest, context: C) => unknown | Promise<unknown>>,
  context: C,
): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
  // Body must be a non-null object or array.
  if (!body || typeof body !== "object") {
    return createJsonRpcError(null, PARSE_ERROR, "Parse error");
  }

  const requests = Array.isArray(body) ? body : [body];

  // Per spec §6: an empty array is an Invalid Request.
  if (requests.length === 0) {
    return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
  }

  const responses = await Promise.all(
    requests.map((raw) => processJsonRpcMethod(raw, methodMap, context)),
  );

  // Filter out notifications (undefined responses) before returning.
  const finalResponses = responses.filter((r): r is JsonRpcResponse => r !== undefined);

  // Per spec §6, even when request is a batch, the server MUST NOT return an empty array.
  // If there are no responses to return (e.g. all notifications), return nothing.
  if (finalResponses.length === 0) {
    return undefined;
  }

  // For a single request, return the single response object.
  // For a batch request, return the array of response objects.
  return Array.isArray(body) ? finalResponses : finalResponses[0];
}

/**
 * Processes a single JSON-RPC request (or an invalid item in a batch).
 *
 * @param raw The raw parsed request object.
 * @param methodMap The null-prototype method lookup map.
 * @param context The context passed to method handlers (H3Event for HTTP, WebSocketPeer for WS).
 */
async function processJsonRpcMethod<C extends H3Event | WebSocketPeer>(
  raw: unknown,
  methodMap: Record<string, (data: JsonRpcRequest, context: C) => unknown | Promise<unknown>>,
  context: C,
): Promise<JsonRpcResponse | undefined> {
  // Each item in a batch must be an object.
  // Per spec §6 examples: [1,2,3] → array of Invalid Request errors.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
  }

  const req = raw as Record<string, unknown>;

  // Validate the request structure per §4.
  if (
    req.jsonrpc !== "2.0" ||
    typeof req.method !== "string" ||
    ("id" in req && !isValidId(req.id))
  ) {
    // When the request is invalid, use id if it's a valid type, otherwise null.
    const id = "id" in req && isValidId(req.id) ? req.id : null;
    return createJsonRpcError(id, INVALID_REQUEST, "Invalid Request");
  }

  // Validate params type if present (§4.2: MUST be Array or Object).
  if (
    "params" in req &&
    req.params !== undefined &&
    (typeof req.params !== "object" || req.params === null)
  ) {
    return isNotification(req)
      ? undefined
      : createJsonRpcError(req.id as string | number | null, INVALID_PARAMS, "Invalid params");
  }

  // Per spec §8: method names starting with "rpc." are reserved.
  if ((req.method as string).startsWith("rpc.")) {
    return isNotification(req)
      ? undefined
      : createJsonRpcError(req.id as string | number | null, METHOD_NOT_FOUND, "Method not found");
  }

  const method = req.method as string;
  const params = req.params as JsonRpcParams | undefined;
  const notification = isNotification(req);
  const id = notification ? undefined : (req.id as string | number | null);

  // Safe method lookup from the null-prototype map.
  const methodHandler = methodMap[method];

  // If the method is not found return an error unless it's a notification, as per §4.1.
  if (!methodHandler) {
    return notification ? undefined : createJsonRpcError(id!, METHOD_NOT_FOUND, "Method not found");
  }

  // Execute the method handler.
  try {
    const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", method, params };
    if (!notification) {
      rpcReq.id = id;
    }

    const result = await methodHandler(rpcReq, context);

    // For notifications, the server MUST NOT reply (§4.1).
    return notification ? undefined : { jsonrpc: "2.0" as const, id: id!, result: result ?? null };
  } catch (error_: any) {
    // For notifications, errors are silently discarded (§4.1).
    if (notification) {
      return undefined;
    }

    // If the handler throws, wrap it in a JSON-RPC error response.
    const h3Error = HTTPError.isError(error_)
      ? error_
      : {
          status: 500,
          message: "Internal error",
          data:
            error_ != null && typeof error_ === "object" && "message" in error_
              ? error_.message
              : undefined,
        };
    const statusCode = h3Error.status;
    const statusMessage = h3Error.message;

    // Map HTTP status codes to semantically appropriate JSON-RPC error codes.
    const errorCode = mapHttpStatusToJsonRpcError(statusCode);

    return createJsonRpcError(id!, errorCode, statusMessage, h3Error.data);
  }
}

/**
 * Maps HTTP status codes to semantically appropriate JSON-RPC error codes.
 *
 * Uses the reserved server error range (-32000 to -32099) for HTTP-specific
 * errors, allowing LLM clients and other consumers to distinguish between
 * different types of failures.
 */
function mapHttpStatusToJsonRpcError(status: number): number {
  switch (status) {
    // Parameter validation errors → INVALID_PARAMS
    case 400: // Bad Request
    case 422: // Unprocessable Entity
      return INVALID_PARAMS;

    // Authentication/Authorization → implementation-defined server errors (-32000 to -32099)
    case 401:
      return -32_001; // Unauthorized
    case 403:
      return -32_003; // Forbidden
    case 404:
      return -32_004; // Not Found
    case 408:
      return -32_008; // Timeout
    case 409:
      return -32_009; // Conflict
    case 429:
      return -32_029; // Rate Limited

    default:
      // 3xx redirects → generic server error (unusual but possible)
      // Other 4xx errors → generic server error
      if (status >= 300 && status < 500) {
        return -32_000;
      }
      return -32_603; // 5xx and other errors → Internal error
  }
}

/**
 * Check if a request is a notification (no "id" member present).
 *
 * Per the JSON-RPC 2.0 spec (§4.1), a notification is a Request object
 * without an "id" member. Note: `id: null` is NOT a notification — it's
 * a regular request with a null id that requires a response.
 */
function isNotification(req: Record<string, unknown>): boolean {
  return !("id" in req);
}

/**
 * Validate that the `id` field (if present) conforms to the spec.
 * Per §4, `id` MUST be a String, Number, or Null.
 */
function isValidId(id: unknown): id is string | number | null {
  if (id === null) return true;
  if (typeof id === "string") return true;
  return typeof id === "number" && Number.isInteger(id);
}

/**
 * Creates a JSON-RPC error response object.
 */
const createJsonRpcError = (
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse => {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
};
