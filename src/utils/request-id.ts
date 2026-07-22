import { getEventContext } from "./event.ts";

import type { HTTPEvent } from "../event.ts";
import type { H3EventContext } from "../types/context.ts";
import type { Middleware } from "../types/handler.ts";

export interface RequestIdOptions {
  /**
   * Request header to read an incoming id from, and to set on the response.
   * @default "x-request-id"
   */
  header?: string;

  /**
   * Reuse an id already present on the incoming request's header instead of
   * always generating a fresh one.
   * @default true
   */
  trustIncoming?: boolean;

  /**
   * Generate a new id.
   * @default () => crypto.randomUUID()
   */
  generate?: (event: HTTPEvent) => string;
}

/**
 * Create a middleware that assigns a request id to `event.context.requestId`
 * and echoes it on the response, for correlating logs/traces across a request.
 *
 * @example
 * import { H3, requestId } from "h3";
 * const app = new H3().use(requestId());
 * app.get("/", (event) => `Request id: ${event.context.requestId}`);
 */
export function requestId(opts: RequestIdOptions = {}): Middleware {
  const header = opts.header || "x-request-id";
  const generate = opts.generate || (() => crypto.randomUUID());
  return (event, next) => {
    const incoming = opts.trustIncoming === false ? null : event.req.headers.get(header);
    const id = incoming || generate(event);
    getEventContext<H3EventContext>(event).requestId = id;
    if (!event.res.headers.has(header)) {
      event.res.headers.set(header, id);
    }
    return next();
  };
}
