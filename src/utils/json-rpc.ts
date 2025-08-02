import type { H3Event } from "../event.ts";
import { defineHandler } from "../handler.ts";
import type { EventHandler } from "../types/handler.ts";
import { HTTPError } from "../error.ts";

/**
 * JSON-RPC 2.0 Interfaces based on the specification.
 * https://www.jsonrpc.org/specification
 */

/**
 * JSON-RPC 2.0 Request object.
 */
interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
  id?: string | number | null;
}

/**
 * JSON-RPC 2.0 Error object.
 */
interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/**
 * JSON-RPC 2.0 Response object.
 */
interface JsonRpcResponse<D = unknown> {
  jsonrpc: "2.0";
  result?: D;
  error?: JsonRpcError;
  id: string | number | null;
}

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
 * A function that handles a JSON-RPC method call.
 * It receives the parameters from the request and the original H3Event.
 */
export type JsonRpcMethodHandler<T = unknown, D = unknown> = (
  params: T,
  event: H3Event,
) => D | Promise<D>;

/**
 * A map of method names to their corresponding handler functions.
 */
export type JsonRpcMethodMap<T = unknown, D = unknown> = Record<
  string,
  JsonRpcMethodHandler<T, D>
>;

/**
 * Creates an H3 event handler that implements the JSON-RPC 2.0 specification.
 *
 * @param methods A map of RPC method names to their handler functions.
 * @returns An H3 EventHandler.
 */
export function defineJsonRpcHandler<T = unknown, D = unknown>(
  methods: JsonRpcMethodMap<T, D>,
): EventHandler {
  return defineHandler(async (event: H3Event) => {
    // JSON-RPC requests must be POST.
    if (event.req.method !== "POST") {
      throw new HTTPError({
        status: 405,
        message: "Method Not Allowed",
      });
    }

    // Helper to construct and return a JSON-RPC error response.
    const sendJsonRpcError = (
      id: string | number | null,
      code: number,
      message: string,
      data?: any,
    ): JsonRpcResponse<D> => {
      const error: JsonRpcError = { code, message };
      if (data) {
        error.data = data;
      }
      return { jsonrpc: "2.0", id, error };
    };

    let hasErrored = false;
    let error = undefined;
    const body = (await event.req.json().catch((error_) => {
      hasErrored = true;
      error = error_;
      return undefined;
    })) as JsonRpcRequest<T> | JsonRpcRequest<T>[] | undefined;

    if (hasErrored || !body) {
      return sendJsonRpcError(null, PARSE_ERROR, "Parse error", error);
    }

    const isBatch = Array.isArray(body);
    const requests: JsonRpcRequest<T>[] = isBatch ? body : [body];

    // Processes a single JSON-RPC request.
    const processRequest = async (
      req: JsonRpcRequest<T>,
    ): Promise<JsonRpcResponse<D> | undefined> => {
      // Validate the request object.
      if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
        return sendJsonRpcError(
          req.id ?? null,
          INVALID_REQUEST,
          "Invalid Request",
        );
      }

      const { id, method, params } = req;
      const handler = methods[method];

      // If the method is not found, return an error.
      if (!handler) {
        // But only if it's not a notification.
        if (id !== undefined && id !== null) {
          return sendJsonRpcError(id, METHOD_NOT_FOUND, "Method not found");
        }
        return undefined;
      }

      // Execute the method handler.
      try {
        const result = await handler(params || ({} as T), event);

        // For notifications, we don't send a response.
        if (id !== undefined && id !== null) {
          return { jsonrpc: "2.0", id, result };
        }
        return undefined;
      } catch (error_: any) {
        // If the handler throws an error, wrap it in a JSON-RPC error.
        if (id !== undefined && id !== null) {
          const h3Error = HTTPError.isError(error_)
            ? error_
            : { status: 500, message: "Internal error", data: error_ };
          const statusCode = h3Error.status;
          const statusMessage = h3Error.message;

          // Map HTTP status codes to JSON-RPC error codes.
          const errorCode =
            statusCode >= 400 && statusCode < 500
              ? INVALID_PARAMS
              : INTERNAL_ERROR;

          return sendJsonRpcError(id, errorCode, statusMessage, h3Error.data);
        }
        return undefined;
      }
    };

    const responses = await Promise.all(
      requests.map((element) => processRequest(element)),
    );

    // Filter out undefined results from notifications.
    const finalResponses = responses.filter(
      (r): r is JsonRpcResponse<D> => r !== undefined,
    );

    event.res.headers.set("Content-Type", "application/json");

    // If it was a batch request but contained only notifications, send 202 Accepted.
    if (isBatch && finalResponses.length === 0) {
      event.res.status = 202;
      return "";
    }

    // If it was a single notification, send 202 Accepted.
    if (!isBatch && finalResponses.length === 0) {
      event.res.status = 202;
      return "";
    }

    // For a single request, return the single response object.
    // For a batch request, return the array of response objects.
    return isBatch ? finalResponses : finalResponses[0];
  });
}
