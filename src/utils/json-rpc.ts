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
export interface JsonRpcRequest<I = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: I;
  id?: string | number | null | undefined;
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
      error?: undefined;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: JsonRpcError;
      result?: undefined;
    };

/**
 * A function that handles a JSON-RPC method call.
 * It receives the parameters from the request and the original H3Event.
 */
export type JsonRpcMethodHandler<I = unknown, O = I> = (
  data: JsonRpcRequest<I>,
  event: H3Event,
) => O | Promise<O>;

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
 * @returns An H3 EventHandler.
 *
 * @example
 * app.post("/rpc", defineJsonRpcHandler({
 *   echo: ({ params }, event) => {
 *     return `Recieved \`${params}\` on path \`${event.url.pathname}\``;
 *   },
 *   sum: ({ params }, event) => {
 *     return params.a + params.b;
 *   },
 * }));
 */
export function defineJsonRpcHandler(methods: JsonRpcMethodMap): EventHandler {
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
    ): JsonRpcResponse => {
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
    })) as JsonRpcRequest | JsonRpcRequest[] | undefined;

    // Protect against prototype pollution
    function hasUnsafeKeys(obj: any): boolean {
      if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj)) {
          if (
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype"
          ) {
            return true;
          }
          if (
            typeof obj[key] === "object" &&
            obj[key] !== null &&
            hasUnsafeKeys(obj[key])
          ) {
            return true;
          }
        }
      }
      return false;
    }

    if (
      hasErrored ||
      !body ||
      (Array.isArray(body)
        ? body.some((element) => hasUnsafeKeys(element))
        : hasUnsafeKeys(body))
    ) {
      return sendJsonRpcError(null, PARSE_ERROR, "Parse error", error);
    }

    const isBatch = Array.isArray(body);
    const requests: JsonRpcRequest[] = isBatch ? body : [body];

    // Processes a single JSON-RPC request.
    const processRequest = async (
      req: JsonRpcRequest,
    ): Promise<JsonRpcResponse | undefined> => {
      // Validate the request object.
      if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
        return sendJsonRpcError(
          req.id ?? null,
          INVALID_REQUEST,
          "Invalid Request",
        );
      }

      const { jsonrpc, id, method, params } = req;
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
        const result = await handler({ jsonrpc, id, method, params }, event);

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
      (r): r is JsonRpcResponse => r !== undefined,
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
