import { H3Event, type HTTPEvent } from "../event.ts";
import type { H3EventContext } from "../types/context.ts";
import type { ServerRequestContext } from "srvx";

import { onDispose as _onDispose, type DisposeCallback } from "./internal/dispose.ts";

export type { DisposeCallback } from "./internal/dispose.ts";

/**
 * Register a callback that runs once the event is fully over: the response body finished streaming, the client disconnected, or the body errored — on every runtime, not just Node.js.
 *
 * The callback receives `undefined` on normal completion, or the cancel/abort reason otherwise. Callbacks run in registration order after the global `onResponse` hook; sync throws and async rejections are absorbed (reported via `console.error` unless the app is configured with `silent`), and pending async callbacks are passed to `waitUntil`.
 *
 * Registering after disposal invokes the callback immediately. Registration is only guaranteed to observe the end of the event when made during request handling (handler, middleware, or `onResponse`).
 *
 * Note: this signals _"h3 is done with this event"_, not _"the client received the response"_ — for non-streaming bodies on non-Node.js runtimes it fires when the response is handed to the runtime. To react to a client disconnect _while still producing_ the response (for example to abort an upstream fetch), use `event.req.signal` instead.
 *
 * @example
 * app.get("/sse", (event) => {
 *   const interval = setInterval(() => {}, 1000);
 *   onDispose(event, () => clearInterval(interval));
 *   // ... return a streaming response
 * });
 */
export function onDispose(event: H3Event, cb: DisposeCallback): void {
  _onDispose(event, cb);
}

/**
 * Checks if the input is an H3Event object.
 * @param input - The input to check.
 * @returns True if the input is an H3Event object, false otherwise.
 * @see H3Event
 */
export function isEvent(input: any): input is H3Event {
  return input instanceof H3Event || input?.constructor?.__is_event__;
}

/**
 * Checks if the input is an object with `{ req: Request }` signature.
 * @param input - The input to check.
 * @returns True if the input is `{ req: Request }`
 */
export function isHTTPEvent(input: any): input is HTTPEvent {
  return input?.req instanceof Request;
}

/**
 * Gets the context of the event, if it does not exists, initializes a new context on `req.context`.
 */
export function getEventContext<T extends ServerRequestContext | H3EventContext>(
  event: HTTPEvent | H3Event,
): T {
  if ((event as H3Event).context) {
    return (event as H3Event).context as T;
  }
  event.req.context ??= {};
  return event.req.context as T;
}

export function mockEvent(
  _request: string | URL | Request,
  options?: RequestInit & { h3?: H3EventContext },
): H3Event {
  let request: Request;
  if (options?.body && !(options as any).duplex) {
    (options as any).duplex = "half";
  }
  if (typeof _request === "string") {
    let url = _request;
    if (url[0] === "/") {
      url = `http://localhost${url}`;
    }
    request = new Request(url, options);
  } else if (options || _request instanceof URL) {
    request = new Request(_request, options);
  } else {
    request = _request;
  }
  return new H3Event(request);
}
