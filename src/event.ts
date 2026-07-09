import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3EventContext } from "./types/context.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import { decodePathname } from "./utils/internal/path.ts";
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
  _ContextT extends H3EventContext = H3EventContext,
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
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL)
   */
  url: URL;

  /**
   * Event context.
   */
  readonly context: _ContextT;

  /**
   * @internal
   */
  static __is_event__ = true;

  constructor(req: ServerRequest, context?: _ContextT, app?: H3Core) {
    this.context = context || req.context || new EmptyObject();
    this.req = req;
    this.app = app;
    // Parsed URL can be provided by srvx (node) and other runtimes
    const _url = (req as { _url?: URL })._url;
    let url = _url && _url instanceof URL ? _url : new FastURL(req.url);
    // Normalize percent-encoded pathname to prevent middleware bypass
    if (url.pathname.includes("%")) {
      try {
        const pathname = decodePathname(url.pathname);
        if (pathname !== url.pathname) {
          // Clone instead of mutating: the parsed URL is shared with the
          // runtime, and req.url must keep the original wire encoding (#1432)
          url = new FastURL(`${url.protocol}//${url.host}${pathname}${url.search}`);
        }
      } catch {
        // Malformed percent-encoding (e.g. `/foo%`, `/%ZZ`): flag for a 400
        // response and keep the raw pathname so route matching and middleware
        // guards still see one consistent value.
        (this as any)[kMalformedURL] = true;
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
