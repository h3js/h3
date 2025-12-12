import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3EventContext } from "./types/context.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import { FastURL } from "srvx";
import type {
  EventHandlerRequest,
  TypedServerRequest,
} from "./types/handler.ts";
import type { H3Core } from "./h3.ts";

const kEventNS = "h3.internal.event.";

export const kEventRes: unique symbol = /* @__PURE__ */ Symbol.for(
  `${kEventNS}res`,
);

export const kEventResHeaders: unique symbol = /* @__PURE__ */ Symbol.for(
  `${kEventNS}res.headers`,
);

export interface HTTPEvent<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> {
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
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL)
   */
  url: URL;

  /**
   * Event context.
   */
  readonly context: H3EventContext<_RequestT["routerParams"]> & {
    params: _RequestT["routerParams"] extends undefined
      ? undefined
      : _RequestT["routerParams"];
  };

  /**
   * @internal
   */
  static __is_event__ = true;

  constructor(req: ServerRequest, context?: H3EventContext, app?: H3Core) {
    this.context = context || req.context || new EmptyObject();
    this.req = req;
    this.app = app;
    // Parsed URL can be provided by srvx (node) and other runtimes
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
}
