import type { EventHandler, EventHandlerRequest, Middleware } from "../types/handler.ts";
import type { H3Event } from "../event.ts";
import { defineHandler } from "../handler.ts";
import { HTTPError } from "../error.ts";

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
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: O;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: JsonRpcError;
    };

/**
 * A function that handles a JSON-RPC method call.
 * It receives the parameters from the request and the original H3Event.
 */
export type JsonRpcMethodHandler<
  O = unknown,
  I extends JsonRpcParams | undefined = JsonRpcParams | undefined,
> = (data: JsonRpcRequest<I>, event: H3Event) => O | Promise<O>;

/**
 * A map of method names to their corresponding handler functions.
 */
export type JsonRpcMethodMap = Record<string, JsonRpcMethodHandler>;

// Official JSON-RPC 2.0 error codes.
/**
 * Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
 */
const PARSE_ERROR = -32_700;
/**
 * The JSON sent is not a valid Request object.
 */
const INVALID_REQUEST = -32_600;
/**
 * The method does not exist / is not available.
 */
const METHOD_NOT_FOUND = -32_601;
/**
 * Invalid method parameter(s).
 */
const INVALID_PARAMS = -32_602;
/**
 * Internal JSON-RPC error.
 */
const INTERNAL_ERROR = -32_603;
// -32_000 to -32_099 	Reserved for implementation-defined server-errors.

/**
 * Creates an H3 event handler that implements the JSON-RPC 2.0 specification.
 *
 * @param methods A map of RPC method names to their handler functions.
 * @param middleware Optional middleware to apply to the handler.
 * @returns An H3 EventHandler.
 *
 * @example
 * app.post("/rpc", defineJsonRpcHandler({
 *   echo: ({ params }, event) => {
 *     return `Received \`${params}\` on path \`${event.url.pathname}\``;
 *   },
 *   sum: ({ params }, event) => {
 *     return params.a + params.b;
 *   },
 * }));
 */
export function defineJsonRpcHandler<RequestT extends EventHandlerRequest = EventHandlerRequest>(
  methods: JsonRpcMethodMap,
  middleware?: Middleware[],
): EventHandler<RequestT> {
  /**
   * Implementation notes: Build a null-prototype lookup map to prevent prototype pollution.
   * This ensures that method names like "__proto__", "constructor", "toString",
   * "hasOwnProperty", etc. cannot resolve to inherited Object.prototype properties.
   */
  const methodMap: Record<string, JsonRpcMethodHandler> = Object.create(null);
  for (const key of Object.keys(methods)) {
    methodMap[key] = methods[key];
  }

  const handler = async (event: H3Event) => {
    // JSON-RPC requests MUST be POST.
    if (event.req.method !== "POST") {
      throw new HTTPError({
        status: 405,
        message: "Method Not Allowed",
      });
    }

    let body: unknown;
    try {
      body = await event.req.json();
    } catch {
      return createJsonRpcError(null, PARSE_ERROR, "Parse error");
    }

    // Body must be a non-null object or array.
    if (!body || typeof body !== "object") {
      return createJsonRpcError(null, PARSE_ERROR, "Parse error");
    }

    const isBatch = Array.isArray(body);

    // Per spec §6: an empty array is an Invalid Request.
    if (isBatch && (body as unknown[]).length === 0) {
      return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
    }

    const requests: unknown[] = isBatch ? (body as unknown[]) : [body];

    // Processes a single JSON-RPC request (or an invalid item in a batch).
    const processRequest = async (
      raw: unknown,
    ): Promise<JsonRpcResponse | ReadableStream | undefined> => {
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
          : createJsonRpcError(
              req.id as string | number | null,
              METHOD_NOT_FOUND,
              "Method not found",
            );
      }

      const method = req.method;
      const params = req.params as JsonRpcParams | undefined;
      const notification = isNotification(req);
      const id = notification ? undefined : (req.id as string | number | null);

      // Safe method lookup from the null-prototype map.
      const methodHandler = methodMap[method];

      // If the method is not found return an error unless it's a notification, as per §4.1.
      if (!methodHandler) {
        return notification
          ? undefined
          : createJsonRpcError(id!, METHOD_NOT_FOUND, "Method not found");
      }

      // Execute the method handler.
      try {
        const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", method, params };
        if (!notification) {
          rpcReq.id = id;
        }

        const result = await methodHandler(rpcReq, event);

        if (isBatch && result instanceof ReadableStream) {
          throw new HTTPError({
            status: 400,
            message: "Streaming responses are not supported in batch requests.",
          });
        }

        if (result instanceof ReadableStream) {
          return result;
        }

        // For notifications, the server MUST NOT reply (§4.1).
        return notification ? undefined : { jsonrpc: "2.0" as const, id: id!, result };
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

        // Map HTTP status codes to JSON-RPC error codes.
        const errorCode = statusCode >= 400 && statusCode < 500 ? INVALID_PARAMS : INTERNAL_ERROR;

        return createJsonRpcError(id!, errorCode, statusMessage, h3Error.data);
      }
    };

    const responses = await Promise.all(requests.map((element) => processRequest(element)));

    if (!isBatch && responses.length === 1 && responses[0] instanceof ReadableStream) {
      event.res.headers.set("Content-Type", "text/event-stream");
      return responses[0];
    }

    // Filter out notifications (undefined responses) before returning.
    const finalResponses = responses.filter((r): r is JsonRpcResponse => r !== undefined);

    event.res.headers.set("Content-Type", "application/json");

    // Per spec §6, even when request is a batch, the server MUST NOT return an empty array.
    // If there are no responses to return (e.g. all notifications), return nothing.
    if (finalResponses.length === 0) {
      event.res.status = 202;
      return "";
    }

    // For a single request, return the single response object.
    // For a batch request, return the array of response objects.
    return isBatch ? finalResponses : finalResponses[0];
  };

  return defineHandler<RequestT>({
    handler,
    middleware,
  });
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
  const type = typeof id;
  return type === "string" || type === "number";
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
  if (data !== undefined && data !== null) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
};
