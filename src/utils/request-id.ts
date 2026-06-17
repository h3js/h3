import { getEventContext } from "./event.ts";
import { onRequest } from "./middleware.ts";

import type { HTTPEvent } from "../event.ts";
import type { H3EventContext } from "../types/context.ts";
import type { Middleware } from "../types/handler.ts";

export interface RequestIdOptions {
  /**
   * Response header name used to propagate the request ID.
   * @default "x-request-id"
   */
  header?: string;

  /**
   * Generate a new request ID when none is present on the incoming request.
   * @default crypto.randomUUID()
   */
  generate?: () => string;

  /**
   * Reuse the incoming request ID header when present.
   * @default true
   */
  trustIncoming?: boolean;
}

const DEFAULT_HEADER = "x-request-id";

/**
 * Get the request ID attached to the current event.
 */
export function getRequestId(event: HTTPEvent): string | undefined {
  return getEventContext<H3EventContext>(event).requestId;
}

/**
 * Create middleware that generates or propagates a request ID.
 *
 * @example
 * import { H3, requestId } from "h3";
 *
 * const app = new H3();
 * app.use(requestId());
 */
export function requestId(opts: RequestIdOptions = {}): Middleware {
  const header = (opts.header ?? DEFAULT_HEADER).toLowerCase();
  const generate = opts.generate ?? (() => crypto.randomUUID());
  const trustIncoming = opts.trustIncoming ?? true;

  return onRequest((event) => {
    let id = trustIncoming ? event.req.headers.get(header) : null;
    if (!id) {
      id = generate();
    }

    const context = getEventContext<H3EventContext>(event);
    context.requestId = id;
    event.res.headers.set(header, id);
    event.res.errHeaders.set(header, id);
  });
}
