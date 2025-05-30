import { createRouter, addRoute, findRoute } from "rou3";
import { serve as srvxServe } from "srvx";
import { getPathname, joinURL } from "./utils/internal/path.ts";
import { _H3Event } from "./event.ts";
import { handleResponse, kNotFound } from "./response.ts";
import { callMiddleware, defineMiddleware } from "./middleware.ts";

import type { ServerOptions, Server } from "srvx";
import type { RouterContext } from "rou3";
import type { H3Route, HTTPMethod, WebSocketOptions } from "./types/h3.ts";
import type { H3Config } from "./types/h3.ts";
import type { H3Event, H3EventContext } from "./types/event.ts";
import type {
  EventHandler,
  EventHandlerRequest,
  ResolvedEventHandler,
  Middleware,
  MiddlewareOptions,
} from "./types/handler.ts";
/**
 * Serve the h3 app, automatically handles current runtime behavior.
 */
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server {
  return srvxServe({ fetch: app.fetch, ...options });
}

export class H3 {
  #middleware: Middleware[];

  #router?: RouterContext<H3Route>;

  /**
   * Global h3 instance config.
   */
  readonly config: H3Config;

  /**
   * An h3 compatible event handler useful to compose multiple h3 app instances.
   */
  handler: EventHandler<EventHandlerRequest, unknown | Promise<unknown>>;

  /**
   * Create a new h3 app instance
   *
   * @param config - h3 config
   */
  constructor(config: H3Config = {}) {
    this.#middleware = [];
    this.config = config;

    this.fetch = this.fetch.bind(this);

    this.handler = Object.assign((event: H3Event) => this.#handler(event), {
      resolve: (method: HTTPMethod, path: string) => this.resolve(method, path),
      websocket: this.config.websocket,
    } satisfies Partial<EventHandler>);
  }

  /**
   * Websocket hooks compatible with [🔌 crossws](https://crossws.h3.dev/).
   */
  get websocket(): WebSocketOptions {
    return {
      ...this.config.websocket,
      resolve: async (info: { url: string; method?: string }) => {
        const pathname = getPathname(info.url || "/");
        const method = (info.method || "GET") as HTTPMethod;
        const resolved = await this.resolve(method, pathname);
        return resolved?.handler?.websocket?.hooks || {};
      },
    };
  }

  /**
   * A [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)-like API allowing to fetch app routes.
   *
   * Input can be a URL, relative path or standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object.
   *
   * Returned value is a standard [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) or a promise resolving to a Response.
   */
  fetch(
    _request: Request | URL | string,
    options?: RequestInit,
    context?: H3EventContext,
  ): Response | Promise<Response> {
    // Normalize request
    let request: Request;
    if (typeof _request === "string") {
      let url = _request;
      if (url[0] === "/") {
        const host = getHeader("Host", options?.headers) || ".";
        const proto =
          getHeader("X-Forwarded-Proto", options?.headers) === "https"
            ? "https"
            : "http";
        url = `${proto}://${host}${url}`;
      }
      request = new Request(url, options);
    } else if (options || _request instanceof URL) {
      request = new Request(_request, options);
    } else {
      request = _request;
    }

    // Create a new event instance
    const event = new _H3Event(request, context);

    // Execute the handler
    let handlerRes: unknown | Promise<unknown>;
    try {
      if (this.config.onRequest) {
        const hookRes = this.config.onRequest(event);
        handlerRes =
          hookRes instanceof Promise
            ? hookRes.then(() => this.#handler(event))
            : this.#handler(event);
      } else {
        handlerRes = this.#handler(event);
      }
    } catch (error: any) {
      handlerRes = Promise.reject(error);
    }

    // Prepare response
    return handleResponse(handlerRes, event, this.config);
  }

  #handler(event: H3Event) {
    const route = this.#router
      ? findRoute(this.#router, event.req.method, event.url.pathname)
      : undefined;
    if (route) {
      event.context.params = route.params;
      event.context.matchedRoute = route.data;
    }
    return callMiddleware(event, this.#middleware, () => {
      return route ? route.data.handler(event) : kNotFound;
    });
  }

  /**
   * Resolve a route handler by method and path.
   */
  async resolve(
    method: HTTPMethod,
    path: string,
  ): Promise<ResolvedEventHandler | undefined> {
    const match = this.#router && findRoute(this.#router, method, path);

    if (!match) {
      return undefined;
    }

    const resolved = {
      route: match.data.route,
      handler: match.data.handler,
      params: match.params,
    };

    while (resolved.handler?.resolve) {
      const _resolved = await resolved.handler.resolve(method, path);
      if (!_resolved) {
        break;
      }
      if (_resolved.route) {
        let base = resolved.route || "";
        if (base.endsWith("/**")) {
          base = base.slice(0, -3);
        }
        resolved.route = joinURL(base, _resolved.route);
      }
      if (_resolved.params) {
        resolved.params = { ...resolved.params, ..._resolved.params };
      }
      if (!_resolved.handler || _resolved.handler === resolved.handler) {
        break;
      }
      resolved.handler = _resolved.handler;
    }

    return resolved;
  }

  all(route: string, handler: EventHandler | H3): this {
    return this.on("", route, handler);
  }

  get(route: string, handler: EventHandler | H3): this {
    return this.on("GET", route, handler);
  }

  post(route: string, handler: EventHandler | H3): this {
    return this.on("POST", route, handler);
  }

  put(route: string, handler: EventHandler | H3): this {
    return this.on("PUT", route, handler);
  }

  delete(route: string, handler: EventHandler | H3): this {
    return this.on("DELETE", route, handler);
  }

  patch(route: string, handler: EventHandler | H3): this {
    return this.on("PATCH", route, handler);
  }

  head(route: string, handler: EventHandler | H3): this {
    return this.on("HEAD", route, handler);
  }

  options(route: string, handler: EventHandler | H3): this {
    return this.on("OPTIONS", route, handler);
  }

  connect(route: string, handler: EventHandler | H3): this {
    return this.on("CONNECT", route, handler);
  }

  trace(route: string, handler: EventHandler | H3): this {
    return this.on("TRACE", route, handler);
  }

  on(
    method: HTTPMethod | Lowercase<HTTPMethod> | "",
    route: string,
    handler: EventHandler | H3,
  ): this {
    if (!this.#router) {
      this.#router = createRouter();
    }
    const _method = (method || "").toUpperCase();
    const _handler = (handler as H3)?.handler || handler;
    addRoute(this.#router, _method, route, {
      method: _method as HTTPMethod,
      route,
      handler: _handler,
    } satisfies H3Route);
    return this;
  }

  /**
   * Register a global middleware
   */
  use(input: Middleware | H3, opts?: MiddlewareOptions): this {
    this.#middleware.push(defineMiddleware(input, opts));
    return this;
  }
}

function getHeader(name: string, headers: HeadersInit | undefined) {
  if (!headers) {
    return;
  }
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const lName = name.toLowerCase();
  if (Array.isArray(headers)) {
    return headers.find(
      (h) => h[0] === name || lName === h[0].toLowerCase(),
    )?.[1];
  }
  return (
    (headers as Record<string, string>)[name] ||
    (headers as Record<string, string>)[lName]
  );
}
