import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3EventContext } from "./types/context.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import { FastURL } from "srvx";
import type { EventHandlerRequest, TypedServerRequest } from "./types/handler.ts";
import type { H3Core } from "./h3.ts";

const kEventNS = "h3.internal.event.";

export const kEventRes: unique symbol = /* @__PURE__ */ Symbol.for(`${kEventNS}res`);

export const kEventResHeaders: unique symbol = /* @__PURE__ */ Symbol.for(`${kEventNS}res.headers`);
export const kEventResErrHeaders: unique symbol = /* @__PURE__ */ Symbol.for(
  `${kEventNS}res.err.headers`,
);

export interface HTTPEvent<_RequestT extends EventHandlerRequest = EventHandlerRequest> {
  /**
   * Incoming HTTP request info.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Request)
   */
  req: TypedServerRequest<_RequestT>;
}

export class H3Event<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> implements HTTPEvent<_RequestT> {
  /**
   * Access to the H3 application instance.
   */
  app?: H3Core;

  /**
   * Incoming HTTP request info.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Request)
   */
  readonly req: TypedServerRequest<_RequestT>;

  /**
   * Access to the parsed request URL.
   *
   * H3 never rewrites it: `event.url.pathname` is the path exactly as it arrived
   * on the wire (only the URL parser's own normalization applies, e.g. a literal
   * `/a/../b` resolves to `/b`), so it always agrees with `event.req.url`, and
   * route matching, `use()` matchers and a handler reading `event.url.pathname`
   * all compare one and the same string.
   *
   * That stays safe because a path whose *decoded* form would name a different
   * resource never reaches a handler: a request that percent-encodes an
   * unreserved character (`/%61dmin`, which every decoding consumer resolves to
   * `/admin`) is answered with a `308` to its canonical form before routing,
   * unless the `allowNonCanonicalURL` app option is enabled. Malformed encoding
   * (`/foo%`, `/%ZZ`) is rejected with a `400`, unless `allowMalformedURL` is
   * enabled.
   *
   * What remains is therefore opaque, and must be treated as such: `%2F`/`%5C`
   * keep a separator out of a `:param` the router matched as one segment, and
   * decoding `pathname` yourself can reintroduce a `/` or `..` that routing and
   * middleware never saw (path traversal). To read a route param in decoded form
   * use `getRouterParams(event, { decode: true })`, which keeps encoded
   * separators encoded.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL)
   */
  url: URL;

  /**
   * Event context.
   */
  readonly context: H3EventContext;

  /**
   * @internal
   */
  static __is_event__ = true;

  constructor(req: ServerRequest, context?: H3EventContext, app?: H3Core) {
    // Keep `event.context` and `req.context` as the same reference so utilities
    // reading `event.req.context` (e.g. getRequestIP) observe writes to
    // `event.context`. Without the write-back, an explicit `context` or an
    // unset `req.context` leaves the two objects diverged.
    this.context = req.context = context || req.context || new EmptyObject();
    this.req = req;
    this.app = app;
    // Parsed URL can be provided by srvx (node) and other runtimes. It is used
    // as-is: the pathname is never decoded or re-serialized here, so the URL
    // shared with the runtime is neither mutated nor cloned (#1432), and
    // `event.url` cannot drift from `event.req.url`. Requests whose encoding
    // would make the two read differently are screened out before routing
    // (see `checkRequestURL` in `h3.ts`).
    const _url = (req as { _url?: URL })._url;
    this.url = _url && _url instanceof URL ? _url : new FastURL(req.url);
  }

  /**
   * Prepared HTTP response.
   */
  get res(): H3EventResponse {
    return ((this as any)[kEventRes] ||= new H3EventResponse());
  }

  /**
   * Access to runtime specific additional context.
   *
   */
  get runtime(): ServerRuntimeContext | undefined {
    return this.req.runtime;
  }

  /**
   * Tell the runtime about an ongoing operation that shouldn't close until the promise resolves.
   */
  waitUntil(promise: Promise<any>): void {
    this.req.waitUntil?.(promise);
  }

  toString(): string {
    return `[${this.req.method}] ${this.req.url}`;
  }

  toJSON(): string {
    return this.toString();
  }

  // ------------- deprecated  ---------------

  /**
   * Access to the raw Node.js req/res objects.
   *
   * @deprecated Use `event.runtime.{node|deno|bun|...}.` instead.
   */
  get node(): ServerRuntimeContext["node"] | undefined {
    return this.req.runtime?.node;
  }

  /**
   * Access to the incoming request headers.
   *
   * @deprecated Use `event.req.headers` instead.
   *
   */
  get headers(): Headers {
    return this.req.headers;
  }

  /**
   * Access to the incoming request url (pathname+search).
   *
   * @deprecated Use `event.url.pathname + event.url.search` instead.
   *
   * Example: `/api/hello?name=world`
   * */
  get path(): string {
    return this.url.pathname + this.url.search;
  }

  /**
   * Access to the incoming request method.
   *
   * @deprecated Use `event.req.method` instead.
   */
  get method(): string {
    return this.req.method;
  }
}

class H3EventResponse {
  status?: number;
  statusText?: string;

  get headers(): Headers {
    return ((this as any)[kEventResHeaders] ||= new Headers());
  }

  get errHeaders(): Headers {
    return ((this as any)[kEventResErrHeaders] ||= new Headers());
  }
}
