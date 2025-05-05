import type { Readable } from "node:stream";
import type { Socket } from "node:net";
import type { H3Event } from "../event";
import type {
  HTTPHeaderName,
  MimeType,
  TypedHeaders,
  StatusCode,
} from "../types";
import { MIMES } from "./consts";
import { sanitizeStatusCode, sanitizeStatusMessage } from "./sanitize";
import { splitCookiesString } from "./cookie";
import { hasProp } from "./internal/object";
import {
  serializeIterableValue,
  coerceIterable,
  IterationSource,
  IteratorSerializer,
} from "./internal/iterable";

const defer =
  typeof setImmediate === "undefined" ? (fn: () => any) => fn() : setImmediate;

/**
 * Directly send a response to the client.
 *
 * **Note:** This function should be used only when you want to send a response directly without using the `h3` event.
 * Normally you can directly `return` a value inside event handlers.
 */
export function send(
  event: H3Event,
  data?: any,
  type?: MimeType,
): Promise<void> {
  if (type) {
    defaultContentType(event, type);
  }
  return new Promise((resolve) => {
    defer(() => {
      if (!event.handled) {
        event.node.res.end(data);
      }
      resolve();
    });
  });
}

/**
 * Respond with an empty payload.
 *
 * Note that calling this function will close the connection and no other data can be sent to the client afterwards.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   return sendNoContent(event);
 * });
 * @example
 * export default defineEventHandler((event) => {
 *   sendNoContent(event); // Close the connection
 *   console.log("This will not be executed");
 * });
 *
 * @param event H3 event
 * @param code status code to be send. By default, it is `204 No Content`.
 */
export function sendNoContent(event: H3Event, code?: StatusCode) {
  if (event.handled) {
    return;
  }

  if (!code && event.node.res.statusCode !== 200) {
    // status code was set with setResponseStatus
    code = event.node.res.statusCode;
  }
  const _code = sanitizeStatusCode(code, 204);
  // 204 responses MUST NOT have a Content-Length header field
  // https://www.rfc-editor.org/rfc/rfc7230#section-3.3.2
  if (_code === 204) {
    event.node.res.removeHeader("content-length");
  }
  event.node.res.writeHead(_code);
  event.node.res.end();
}

/**
 * Set the response status code and message.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   setResponseStatus(event, 404, "Not Found");
 *   return "Not Found";
 * });
 */
export function setResponseStatus(
  event: H3Event,
  code?: StatusCode,
  text?: string,
): void {
  if (code) {
    event.node.res.statusCode = sanitizeStatusCode(
      code,
      event.node.res.statusCode,
    );
  }
  if (text) {
    event.node.res.statusMessage = sanitizeStatusMessage(text);
  }
}

/**
 * Get the current response status code.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const status = getResponseStatus(event);
 *   return `Status: ${status}`;
 * });
 */
export function getResponseStatus(event: H3Event): number {
  return event.node.res.statusCode;
}

/**
 * Get the current response status message.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const statusText = getResponseStatusText(event);
 *   return `Status: ${statusText}`;
 * });
 */
export function getResponseStatusText(event: H3Event): string {
  return event.node.res.statusMessage;
}

/**
 * Set the response status code and message.
 */
export function defaultContentType(event: H3Event, type?: MimeType) {
  if (
    type &&
    event.node.res.statusCode !== 304 /* unjs/h3#603 */ &&
    !event.node.res.getHeader("content-type")
  ) {
    event.node.res.setHeader("content-type", type);
  }
}

/**
 * Send a redirect response to the client.
 *
 * It adds the `location` header to the response and sets the status code to 302 by default.
 *
 * In the body, it sends a simple HTML page with a meta refresh tag to redirect the client in case the headers are ignored.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   return sendRedirect(event, "https://example.com");
 * });
 *
 * @example
 * export default defineEventHandler((event) => {
 *   return sendRedirect(event, "https://example.com", 301); // Permanent redirect
 * });
 */
export function sendRedirect(
  event: H3Event,
  location: string,
  code: StatusCode = 302,
) {
  event.node.res.statusCode = sanitizeStatusCode(
    code,
    event.node.res.statusCode,
  );
  event.node.res.setHeader("location", location);
  const encodedLoc = location.replace(/"/g, "%22");
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${encodedLoc}"></head></html>`;
  return send(event, html, MIMES.html);
}

/**
 * Get the response headers object.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const headers = getResponseHeaders(event);
 * });
 */
export function getResponseHeaders(
  event: H3Event,
): ReturnType<H3Event["node"]["res"]["getHeaders"]> {
  return event.node.res.getHeaders();
}

/**
 * Get a response header by name.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const contentType = getResponseHeader(event, "content-type"); // Get the response content-type header
 * });
 */
export function getResponseHeader(
  event: H3Event,
  name: HTTPHeaderName,
): ReturnType<H3Event["node"]["res"]["getHeader"]> {
  return event.node.res.getHeader(name);
}

/**
 * Set the response headers.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   setResponseHeaders(event, {
 *     "content-type": "text/html",
 *     "cache-control": "no-cache",
 *   });
 * });
 */
export function setResponseHeaders(
  event: H3Event,
  headers: TypedHeaders,
): void {
  for (const [name, value] of Object.entries(headers)) {
    event.node.res.setHeader(
      name,
      value! as unknown as number | string | readonly string[],
    );
  }
}

/**
 * Alias for `setResponseHeaders`.
 */
export const setHeaders = setResponseHeaders;

/**
 * Set a response header by name.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   setResponseHeader(event, "content-type", "text/html");
 * });
 */
export function setResponseHeader<T extends HTTPHeaderName>(
  event: H3Event,
  name: T,
  value: TypedHeaders[Lowercase<T>],
): void {
  event.node.res.setHeader(name, value as string);
}

/**
 * Alias for `setResponseHeader`.
 */
export const setHeader = setResponseHeader;

/**
 * Append the response headers.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   appendResponseHeaders(event, {
 *     "content-type": "text/html",
 *     "cache-control": "no-cache",
 *   });
 * });
 */
export function appendResponseHeaders(
  event: H3Event,
  headers: TypedHeaders,
): void {
  for (const [name, value] of Object.entries(headers)) {
    appendResponseHeader(event, name, value);
  }
}

/**
 * Alias for `appendResponseHeaders`.
 */
export const appendHeaders = appendResponseHeaders;

/**
 * Append a response header by name.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   appendResponseHeader(event, "content-type", "text/html");
 * });
 */
export function appendResponseHeader<T extends HTTPHeaderName>(
  event: H3Event,
  name: T,
  value: TypedHeaders[Lowercase<T>],
): void {
  let current = event.node.res.getHeader(name);

  if (!current) {
    event.node.res.setHeader(name, value as string);
    return;
  }

  if (!Array.isArray(current)) {
    current = [current.toString()];
  }

  event.node.res.setHeader(name, [...current, value as string]);
}

/**
 * Alias for `appendResponseHeader`.
 */
export const appendHeader = appendResponseHeader;

/**
 * Remove all response headers, or only those specified in the headerNames array.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   clearResponseHeaders(event, ["content-type", "cache-control"]); // Remove content-type and cache-control headers
 * });
 *
 * @param event H3 event
 * @param headerNames Array of header names to remove
 */
export function clearResponseHeaders(
  event: H3Event,
  headerNames?: HTTPHeaderName[],
): void {
  if (headerNames && headerNames.length > 0) {
    for (const name of headerNames) {
      removeResponseHeader(event, name);
    }
  } else {
    for (const [name] of Object.entries(getResponseHeaders(event))) {
      removeResponseHeader(event, name);
    }
  }
}

/**
 * Remove a response header by name.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   removeResponseHeader(event, "content-type"); // Remove content-type header
 * });
 */
export function removeResponseHeader(
  event: H3Event,
  name: HTTPHeaderName,
): void {
  return event.node.res.removeHeader(name);
}

/**
 * Checks if the data is a stream (Node.js Readable Stream, React Pipeable Stream, or Web Stream).
 */
export function isStream(data: any): data is Readable | ReadableStream {
  if (!data || typeof data !== "object") {
    return false;
  }
  if (typeof data.pipe === "function") {
    // Node.js Readable Streams
    if (typeof data._read === "function") {
      return true;
    }
    // React Pipeable Streams
    if (typeof data.abort === "function") {
      return true;
    }
  }
  // Web Streams
  if (typeof data.pipeTo === "function") {
    return true;
  }
  return false;
}

/**
 * Checks if the data is a Response object.
 */
export function isWebResponse(data: any): data is Response {
  return typeof Response !== "undefined" && data instanceof Response;
}

/**
 * Send a stream response to the client.
 *
 * Note: You can directly `return` a stream value inside event handlers alternatively which is recommended.
 */
export function sendStream(
  event: H3Event,
  stream: Readable | ReadableStream,
): Promise<void> {
  // Validate input
  if (!stream || typeof stream !== "object") {
    throw new Error("[h3] Invalid stream provided.");
  }

  // Directly expose stream for worker environments (unjs/unenv)
  (event.node.res as unknown as { _data: BodyInit })._data = stream as BodyInit;

  // Early return if response Socket is not available for worker environments (unjs/nitro)
  if (!event.node.res.socket) {
    event._handled = true;
    // TODO: Hook and handle stream errors
    return Promise.resolve();
  }

  // Native Web Streams
  if (
    hasProp(stream, "pipeTo") &&
    typeof (stream as ReadableStream).pipeTo === "function"
  ) {
    // instantiate a new AbortController to handle request aborts
    const abortController = new AbortController();

    // shared function to handle aborts
    const doAbort = () => {
      abortController.abort("Client closed or lost connection.");
    };

    // Handle request aborts
    event.node.res.on("close", doAbort);
    event.node.res.on("finish", doAbort);
    event.node.res.on("error", doAbort);

    return (stream as ReadableStream)
      .pipeTo(
        new WritableStream({
          write(chunk) {
            event.node.res.write(chunk);
          },
        }),
        {
          signal: abortController.signal,
        },
      )
      .then(() => {
        event.node.res.end();
      });
  }

  // Node.js Readable Streams
  // https://nodejs.org/api/stream.html#readable-streams
  if (
    hasProp(stream, "pipe") &&
    typeof (stream as Readable).pipe === "function"
  ) {
    return new Promise<void>((resolve, reject) => {
      // Pipe stream to response
      (stream as Readable).pipe(event.node.res);

      // Handle stream events (if supported)
      if ((stream as Readable).on) {
        (stream as Readable).on("end", () => {
          event.node.res.end();
          resolve();
        });
        (stream as Readable).on("error", (error: Error) => {
          reject(error);
        });
      }

      // Handle request aborts
      event.node.res.on("close", () => {
        // https://react.dev/reference/react-dom/server/renderToPipeableStream
        if ((stream as any).abort) {
          (stream as any).abort();
        }
      });
    });
  }

  throw new Error("[h3] Invalid or incompatible stream provided.");
}

const noop = () => {};

/**
 * Write `HTTP/1.1 103 Early Hints` to the client.
 */
export function writeEarlyHints(
  event: H3Event,
  hints: string | string[] | Record<string, string | string[]>,
  cb: () => void = noop,
) {
  if (!event.node.res.socket /* && !('writeEarlyHints' in event.node.res) */) {
    cb();
    return;
  }

  // Normalize if string or string[] is provided
  if (typeof hints === "string" || Array.isArray(hints)) {
    hints = { link: hints };
  }

  if (hints.link) {
    hints.link = Array.isArray(hints.link) ? hints.link : hints.link.split(",");
    // TODO: remove when https://github.com/nodejs/node/pull/44874 is released
    // hints.link = hints.link.map(l => l.trim().replace(/; crossorigin/g, ''))
  }

  // TODO: Enable when node 18 api is stable
  // if ('writeEarlyHints' in event.node.res) {
  //   return event.node.res.writeEarlyHints(hints, cb)
  // }

  const headers: [string, string | string[]][] = Object.entries(hints).map(
    (e) => [e[0].toLowerCase(), e[1]],
  );
  if (headers.length === 0) {
    cb();
    return;
  }

  let hint = "HTTP/1.1 103 Early Hints";
  if (hints.link) {
    hint += `\r\nLink: ${(hints.link as string[]).join(", ")}`;
  }

  for (const [header, value] of headers) {
    if (header === "link") {
      continue;
    }
    hint += `\r\n${header}: ${value}`;
  }
  if (event.node.res.socket) {
    (event.node.res as { socket: Socket }).socket.write(
      `${hint}\r\n\r\n`,
      "utf8",
      cb,
    );
  } else {
    cb();
  }
}

/**
 * Send a Response object to the client.
 */
export function sendWebResponse(
  event: H3Event,
  response: Response,
): void | Promise<void> {
  for (const [key, value] of response.headers) {
    if (key === "set-cookie") {
      event.node.res.appendHeader(key, splitCookiesString(value));
    } else {
      event.node.res.setHeader(key, value);
    }
  }

  if (response.status) {
    event.node.res.statusCode = sanitizeStatusCode(
      response.status,
      event.node.res.statusCode,
    );
  }
  if (response.statusText) {
    event.node.res.statusMessage = sanitizeStatusMessage(response.statusText);
  }
  if (response.redirected) {
    event.node.res.setHeader("location", response.url);
  }
  if (!response.body) {
    event.node.res.end();
    return;
  }
  return sendStream(event, response.body);
}

/**
 * Iterate a source of chunks and send back each chunk in order.
 * Supports mixing async work together with emitting chunks.
 *
 * Each chunk must be a string or a buffer.
 *
 * For generator (yielding) functions, the returned value is treated the same as yielded values.
 *
 * @param event - H3 event
 * @param iterable - Iterator that produces chunks of the response.
 * @param serializer - Function that converts values from the iterable into stream-compatible values.
 * @template Value - Test
 *
 * @example
 * sendIterable(event, work());
 * async function* work() {
 *   // Open document body
 *   yield "<!DOCTYPE html>\n<html><body><h1>Executing...</h1><ol>\n";
 *   // Do work ...
 *   for (let i = 0; i < 1000) {
 *     await delay(1000);
 *     // Report progress
 *     yield `<li>Completed job #`;
 *     yield i;
 *     yield `</li>\n`;
 *   }
 *   // Close out the report
 *   return `</ol></body></html>`;
 * }
 * async function delay(ms) {
 *   return new Promise(resolve => setTimeout(resolve, ms));
 * }
 */
export function sendIterable<Value = unknown, Return = unknown>(
  event: H3Event,
  iterable: IterationSource<Value, Return>,
  options?: {
    serializer: IteratorSerializer<Value | Return>;
  },
): Promise<void> {
  const serializer = options?.serializer ?? serializeIterableValue;
  const iterator = coerceIterable(iterable);
  return sendStream(
    event,
    new ReadableStream({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (value !== undefined) {
          const chunk = serializer(value);
          if (chunk !== undefined) {
            controller.enqueue(chunk);
          }
        }
        if (done) {
          controller.close();
        }
      },
      cancel() {
        iterator.return?.();
      },
    }),
  );
}
