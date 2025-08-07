import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3EventContext } from "./types/context.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import { FastURL } from "srvx";
import type {
  EventHandlerRequest,
  TypedServerRequest,
} from "./types/handler.ts";
import type { H3Core } from "./h3.ts";

export class H3Event<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> {
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
  readonly context: H3EventContext;

  /**
   * @internal
   */
  static __is_event__ = true;

  /**
   * @internal
   */
  #res?: H3EventResponse;

  constructor(req: ServerRequest, context?: H3EventContext, app?: H3Core) {
    this.context = context || new EmptyObject();
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
    if (!this.#res) {
      this.#res = new H3EventResponse();
    }
    return this.#res;
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
  #headers?: Headers;
  get headers(): Headers {
    if (!this.#headers) {
      this.#headers = new Headers();
    }
    return this.#headers;
  }
}
