import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3EventContext } from "./types/context.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import {
  canonicalPathname,
  isMalformedPathname,
  isNonCanonicalPathname,
} from "./utils/internal/path.ts";
import { FastURL } from "srvx";
import type { EventHandlerRequest, TypedServerRequest } from "./types/handler.ts";
import type { H3Core } from "./h3.ts";

const kEventNS = "h3.internal.event.";

export const kEventRes: unique symbol = /* @__PURE__ */ Symbol.for(`${kEventNS}res`);

export const kEventResHeaders: unique symbol = /* @__PURE__ */ Symbol.for(`${kEventNS}res.headers`);
export const kEventResErrHeaders: unique symbol = /* @__PURE__ */ Symbol.for(
  `${kEventNS}res.err.headers`,
);

export const kMalformedURL: unique symbol = /* @__PURE__ */ Symbol.for(`${kEventNS}malformed`);

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
   * `event.url.pathname` is the path in its wire encoding, with one exception:
   * an escape that is *needlessly* there is dropped — one whose character
   * survives WHATWG path serialization unchanged, minus `%2F` and `%25` which
   * must stay opaque (e.g. `/%61dmin` -> `/admin`, `/%40handle` -> `/@handle`).
   * This is decoded once, before routing, so that route matching, `use()`
   * matchers and a handler reading `event.url.pathname` all compare one and the
   * same string and `/%61dmin` cannot slip past an `/admin` guard. Nothing else
   * is touched, and `event.req.url` always keeps the original wire encoding.
   * See the "Pathname encoding" section of the guide for the full rule:
   * https://h3.dev/guide/api/h3event#pathname-encoding
   *
   * Malformed encoding (`/foo%`, `/%ZZ`) has no canonical form and is rejected
   * with a `400` before any handler runs, unless the `allowMalformedURL` app
   * option is enabled.
   *
   * Every escape that survives is therefore opaque, and must be treated as such:
   * `%2F`/`%5C` keep a separator out of a `:param` the router matched as one
   * segment, and decoding `pathname` yourself can reintroduce a `/` or `..` that
   * routing and middleware never saw (path traversal). To read a route param in
   * decoded form use `getRouterParams(event, { decode: true })`, which keeps
   * encoded separators encoded.
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
    // Parsed URL can be provided by srvx (node) and other runtimes
    const _url = (req as { _url?: URL })._url;
    let url = _url && _url instanceof URL ? _url : new FastURL(req.url);
    // Canonicalize the pathname before anything can match on it. Done here, in
    // the constructor, so the guarantee holds for every event — including one
    // built by `mockEvent()` or a standalone `handler.fetch()`, which never
    // reach the app dispatch path.
    const pathname = url.pathname;
    if (pathname.includes("%")) {
      if (isMalformedPathname(pathname)) {
        // Malformed percent-encoding (e.g. `/foo%`, `/%ZZ`): no canonical form
        // to decode to. Flag for a 400 response and keep the raw pathname so
        // route matching and middleware guards still see one consistent value.
        (this as any)[kMalformedURL] = true;
      } else if (isNonCanonicalPathname(pathname)) {
        // Clone instead of mutating: the parsed URL is shared with the runtime,
        // and req.url must keep the original wire encoding (#1432). Only reached
        // for a path that is actually non-canonical, so the common `/a%20b` and
        // `/caf%C3%A9` never pay for it. Built as one href and parsed once — the
        // parser resolves any dot segment the decode revealed, so setting
        // `pathname` on a second parse of `req.url` would only pay for it twice.
        url = new FastURL(
          `${url.protocol}//${url.host}${canonicalPathname(pathname)}${url.search}`,
        );
      }
    }
    this.url = url;
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
