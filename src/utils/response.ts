import type { H3Event } from "../event.ts";
import { HTTPResponse } from "../response.ts";
import {
  serializeIterableValue,
  coerceIterable,
  type IterationSource,
  type IteratorSerializer,
} from "./internal/iterable.ts";

/**
 * Respond with an empty payload.<br>
 *
 * @example
 * app.get("/", () => noContent());
 *
 * @param status status code to be send. By default, it is `204 No Content`.
 */
export function noContent(status: number = 204): HTTPResponse {
  return new HTTPResponse(null, {
    status,
    statusText: "No Content",
  });
}

/**
 * Send a redirect response to the client.
 *
 * It adds the `location` header to the response and sets the status code to 302 by default.
 *
 * In the body, it sends a simple HTML page with a meta refresh tag to redirect the client in case the headers are ignored.
 *
 * @example
 * app.get("/", () => {
 *   return redirect("https://example.com");
 * });
 *
 * @example
 * app.get("/", () => {
 *   return redirect("https://example.com", 301); // Permanent redirect
 * });
 */
export function redirect(
  location: string,
  status: number = 302,
  statusText?: string,
): HTTPResponse {
  const encodedLoc = location.replace(/"/g, "%22");
  const body = /* html */ `<html><head><meta http-equiv="refresh" content="0; url=${encodedLoc}" /></head></html>`;
  return new HTTPResponse(body, {
    status,
    statusText: statusText || (status === 301 ? "Moved Permanently" : "Found"),
    headers: {
      "content-type": "text/html; charset=utf-8",
      location,
    },
  });
}

/**
 * Write `HTTP/1.1 103 Early Hints` to the client.
 */
export function writeEarlyHints(
  event: H3Event,
  hints: Record<string, string>,
): void | Promise<void> {
  if (!event.runtime?.node?.res?.writeEarlyHints) {
    return;
  }
  return new Promise((resolve) => {
    event.runtime?.node?.res?.writeEarlyHints(hints, () => resolve());
  });
}

/**
 * Iterate a source of chunks and send back each chunk in order.
 * Supports mixing async work together with emitting chunks.
 *
 * Each chunk must be a string or a buffer.
 *
 * For generator (yielding) functions, the returned value is treated the same as yielded values.
 *
 * @param iterable - Iterator that produces chunks of the response.
 * @param serializer - Function that converts values from the iterable into stream-compatible values.
 * @template Value - Test
 *
 * @example
 * return iterable(async function* work() {
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
 * })
 * async function delay(ms) {
 *   return new Promise(resolve => setTimeout(resolve, ms));
 * }
 */
export function iterable<Value = unknown, Return = unknown>(
  iterable: IterationSource<Value, Return>,
  options?: {
    serializer: IteratorSerializer<Value | Return>;
  },
): HTTPResponse {
  const serializer = options?.serializer ?? serializeIterableValue;
  const iterator = coerceIterable(iterable);
  return new HTTPResponse(
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

/**
 * Respond with HTML content.
 *
 * @example
 * app.get("/", () => html("<h1>Hello, World!</h1>"));
 * app.get("/", () => html`<h1>Hello, ${name}!</h1>`);
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): HTTPResponse;
export function html(markup: string): HTTPResponse;
export function html(
  first: TemplateStringsArray | string,
  ...values: unknown[]
): HTTPResponse {
  const body =
    typeof first === "string"
      ? first
      : first.reduce((out, str, i) => out + str + (values[i] ?? ""), "");
  return new HTTPResponse(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
