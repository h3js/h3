import type { EventHandler, EventHandlerObject, EventHandlerRequest } from "../types/handler.ts";
import type { Hooks as WebSocketHooks, Peer as WebSocketPeer } from "crossws";
import type { H3Event } from "../event.ts";
import { defineHandler } from "../handler.ts";
import { defineWebSocketHandler } from "./ws.ts";
import { isCorsOriginAllowed } from "./internal/cors.ts";
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

// Default upper bound for the number of requests in a single batch.
const DEFAULT_MAX_BATCH_SIZE = 50;

/**
 * Creates an H3 event handler that implements the JSON-RPC 2.0 specification.
 *
 * **Security defaults:** requests must have a JSON `Content-Type` (CSRF, see
 * `validateContentType`), cross-origin requests are rejected (CSRF and DNS
 * rebinding, see `allowedOrigins`), and batches are capped at 50 requests
 * (fan-out amplification, see `maxBatchSize`).
 *
 * @param methods A map of RPC method names to their handler functions.
 * @param middleware Optional middleware to apply to the handler.
 * @returns An H3 EventHandler.
 *
 * @example
 * app.post(
 *   "/rpc",
 *   defineJsonRpcHandler({
 *     methods: {
 *       echo: ({ params }, event) => {
 *         return `Received \`${params}\` on path \`${event.url.pathname}\``;
 *       },
 *       sum: ({ params }, event) => {
 *         return params.a + params.b;
 *       },
 *     },
 *   }),
 * );
 */
export function defineJsonRpcHandler<RequestT extends EventHandlerRequest = EventHandlerRequest>(
  opts: Omit<EventHandlerObject<RequestT>, "handler" | "fetch"> & {
    methods: Record<string, JsonRpcMethod>;

    /**
     * Maximum number of requests allowed in a single batch.
     *
     * Every batch item is dispatched concurrently, so an unbounded batch turns
     * one HTTP request into an arbitrary number of method invocations
     * (per-request rate limiters and quotas count it once) and fans out to
     * upstreams and database pools. Batches larger than this are rejected with
     * an `Invalid Request` (`-32600`) error.
     *
     * Set to `Infinity` to disable the limit.
     *
     * @default 50
     */
    maxBatchSize?: number;

    /**
     * Require a JSON `Content-Type` (`application/json`, `application/json-rpc`
     * or any `+json` media type) and reject anything else with a `415`.
     *
     * This is a CSRF defense: without it, an HTML form (or a typeless `fetch`
     * body) from an attacker page qualifies as a CORS "simple request" and is
     * delivered with the victim's cookies without any preflight. Requiring a
     * JSON content type forces a preflight for cross-origin callers.
     *
     * @default true
     */
    validateContentType?: boolean;

    /**
     * Origins allowed to call this endpoint.
     *
     * By default only same-origin requests are accepted: a request carrying an
     * `Origin` header that does not match the request's own origin is rejected
     * with a `403`. Requests without an `Origin` header (CLI clients,
     * server-to-server, MCP stdio bridges) are always allowed.
     *
     * Pass an explicit allowlist to accept specific cross-origin callers, or
     * `"*"` to disable the check entirely. An allowlist **replaces** the
     * same-origin default rather than extending it, so include this endpoint's
     * own origin as well when browsers served from it call it too.
     *
     * **Behind a proxy:** the same-origin default compares against
     * `event.url.origin`, derived from the request's own protocol and `Host`.
     * A TLS-terminating proxy leaves that `http:` while the browser sends an
     * `https:` `Origin`, so same-origin requests are rejected. Start the server
     * with srvx `trustProxy` when a proxy you control rewrites `X-Forwarded-*`,
     * or pass an explicit allowlist.
     *
     * **Security:** the MCP Streamable HTTP transport requires servers to
     * validate `Origin` to prevent DNS-rebinding attacks. The same-origin
     * default does not stop rebinding on its own (the rebound name is both the
     * `Origin` and the `Host`); locally bound servers should pass an explicit
     * allowlist of the origins they expect (e.g. `["http://localhost:3000"]`).
     *
     * Regular expressions are tested **unanchored** — always anchor them
     * (`/^https:\/\/app\.example\.com$/`).
     */
    allowedOrigins?: "*" | string | (string | RegExp)[] | ((origin: string) => boolean);
  } = {} as any,
): EventHandler<RequestT> {
  const methodMap = createMethodMap(opts.methods);
  const maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const handler = async (event: H3Event) => {
    // JSON-RPC requests MUST be POST.
    if (event.req.method !== "POST") {
      throw new HTTPError({ status: 405 });
    }

    // Reject non-JSON content types (CSRF: see `validateContentType`).
    if (
      opts.validateContentType !== false &&
      !isJsonContentType(event.req.headers.get("content-type"))
    ) {
      throw new HTTPError({ status: 415, message: "Unsupported Media Type" });
    }

    // Reject disallowed origins (CSRF / DNS rebinding: see `allowedOrigins`).
    assertAllowedOrigin(event, opts.allowedOrigins);

    let body: unknown;
    try {
      body = await event.req.json();
    } catch (error) {
      // Keep a real `HTTPError` (e.g. the `413` from an aborted body-limit
      // stream) instead of masking it as a JSON-RPC parse error.
      if (HTTPError.isError(error)) {
        throw error;
      }
      return createJsonRpcError(null, PARSE_ERROR, "Parse error");
    }
    const result = await processJsonRpcBody(body, methodMap, event, maxBatchSize);
    return result === undefined ? new HTTPResponse("", { status: 202 }) : result;
  };
  return defineHandler<RequestT>({ ...opts, handler });
}

/**
 * Check that a request `Content-Type` is a JSON media type.
 */
function isJsonContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const mediaType = value.split(";")[0].trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    mediaType === "application/json-rpc" ||
    mediaType.endsWith("+json")
  );
}

/**
 * Validate the request `Origin` against the allowed origins (default: same-origin only).
 */
function assertAllowedOrigin(
  event: H3Event,
  allowedOrigins: "*" | string | (string | RegExp)[] | ((origin: string) => boolean) | undefined,
): void {
  const origin = event.req.headers.get("origin");

  // Non-browser clients send no `Origin` and are not subject to CSRF.
  if (!origin || allowedOrigins === "*") {
    return;
  }

  const allowed = allowedOrigins
    ? isCorsOriginAllowed(origin, {
        origin: typeof allowedOrigins === "string" ? [allowedOrigins] : allowedOrigins,
      })
    : origin === event.url.origin;

  if (!allowed) {
    throw new HTTPError({ status: 403, message: "Origin not allowed" });
  }
}

/**
 * Creates an H3 event handler that implements JSON-RPC 2.0 over WebSocket.
 *
 * This is an opt-in feature that allows JSON-RPC communication over WebSocket
 * connections for bi-directional messaging. Each incoming WebSocket text message
 * is processed as a JSON-RPC request, and responses are sent back to the peer.
 *
 * **Security:** unlike `defineJsonRpcHandler()`, this does not check the request
 * `Origin`. WebSocket upgrades are not subject to CORS, so a page on any origin
 * can open a connection carrying the visitor's cookies (cross-site WebSocket
 * hijacking). Validate `Origin` in the `upgrade` hook and throw a `Response` to
 * abort the connection.
 *
 * @param opts Options including methods map and optional WebSocket hooks.
 * @returns An H3 EventHandler that upgrades to a WebSocket connection.
 *
 * @example
 * app.get(
 *   "/rpc/ws",
 *   defineJsonRpcWebSocketHandler({
 *     methods: {
 *       echo: ({ params }) => {
 *         return `Received: ${Array.isArray(params) ? params[0] : params?.message}`;
 *       },
 *       sum: ({ params }) => {
 *         return params.a + params.b;
 *       },
 *     },
 *   }),
 * );
 *
 * @example
 * // With additional WebSocket hooks
 * app.get(
 *   "/rpc/ws",
 *   defineJsonRpcWebSocketHandler({
 *     methods: {
 *       greet: ({ params }) => `Hello, ${params.name}!`,
 *     },
 *     hooks: {
 *       open(peer) {
 *         console.log(`Peer connected: ${peer.id}`);
 *       },
 *       close(peer, details) {
 *         console.log(`Peer disconnected: ${peer.id}`, details);
 *       },
 *     },
 *   }),
 * );
 */
export function defineJsonRpcWebSocketHandler(opts: {
  methods: Record<string, JsonRpcWebSocketMethod>;

  /**
   * Maximum number of requests allowed in a single batch message.
   *
   * Batch items are dispatched concurrently, so an unbounded batch lets a
   * single message fan out to an arbitrary number of method invocations.
   * Larger batches are rejected with an `Invalid Request` (`-32600`) error.
   *
   * Set to `Infinity` to disable the limit.
   *
   * @default 50
   */
  maxBatchSize?: number;

  hooks?: Partial<Omit<WebSocketHooks, "message">>;
}): EventHandler {
  const methodMap = createMethodMap(opts.methods);
  const maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
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
      const result = await processJsonRpcBody(body, methodMap, peer, maxBatchSize);
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
  maxBatchSize: number,
): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
  // Body must be a non-null object or array.
  // Note: parsing already succeeded here, so a primitive body is not a Parse
  // error (§5.1 reserves -32700 for invalid JSON) but an Invalid Request.
  if (!body || typeof body !== "object") {
    return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
  }

  const requests = Array.isArray(body) ? body : [body];

  // Per spec §6: an empty array is an Invalid Request.
  if (requests.length === 0) {
    return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
  }

  // Bound the fan-out: every item is dispatched concurrently below, so an
  // unbounded batch amplifies one request into unlimited method invocations.
  if (requests.length > maxBatchSize) {
    return createJsonRpcError(
      null,
      INVALID_REQUEST,
      `Invalid Request: batch size exceeds maximum of ${maxBatchSize}`,
    );
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
    //
    // Never expose internal exception details to untrusted callers: only an
    // `HTTPError` the app threw itself may surface its `message`/`data`.
    // `unhandled` errors are framework-wrapped internal exceptions whose
    // message is lifted from an arbitrary `cause` (e.g. `fromNodeHandler`
    // wrapping a driver error), so they are masked here exactly like
    // `HTTPError.toJSON()` masks them (see `src/error.ts`).
    const isExposable = HTTPError.isError(error_) && !error_.unhandled;
    const h3Error = isExposable
      ? error_
      : {
          status: HTTPError.isError(error_) ? error_.status : 500,
          message: "Internal error",
          data: undefined,
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
