import { createRouter, addRoute, findAllRoutes, findRoute } from "rou3";
import { serve as srvxServe } from "srvx";
import { getPathname, joinURL } from "./utils/internal/path.ts";
import { _H3Event } from "./event.ts";
import { kNotFound, handleResponse } from "./response.ts";

import type { ServerOptions, Server } from "srvx";
import type { RouterContext } from "rou3";
import type { H3Route, HTTPMethod, WebSocketOptions } from "./types/h3.ts";
import type { ResolvedEventHandler } from "./types/handler.ts";
import type { H3Config } from "./types/h3.ts";
import type { H3Event, H3EventContext } from "./types/event.ts";
import type { EventHandler, EventHandlerRequest } from "./types/handler.ts";

/**
 * Serve the h3 app, automatically handles current runtime behavior.
 */
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server {
  return srvxServe({ fetch: app.fetch, ...options });
}

export class H3 {
  #middleware?: H3Route[];
  #mRouter?: RouterContext<H3Route>;
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
    this.config = config;

    this.fetch = this.fetch.bind(this);

    this.handler = Object.assign((event: H3Event) => this.#handler(event), <
      Partial<EventHandler>
    >{
      resolve: (method: HTTPMethod, path: string) => this.resolve(method, path),
      websocket: this.config.websocket,
    });
  }

  /**
   * Websocket hooks compatible with [🔌 crossws](https://crossws.unjs.io/).
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
      handlerRes = this.#handler(event);
    } catch (error: any) {
      handlerRes = Promise.reject(error);
    }

    // Prepare response
    return handleResponse(handlerRes, event, this.config);
  }

  #handler(event: H3Event) {
    const pathname = event.url.pathname;

    let _chain: Promise<unknown> | undefined;

    // 1. Hooks
    if (this.config.onRequest) {
      _chain = Promise.resolve(this.config.onRequest(event));
    }

    // 2. Global middleware
    const _middleware = this.#middleware;
    if (_middleware) {
      _chain = _chain || Promise.resolve();
      for (const m of _middleware) {
        _chain = _chain.then((_previous) => {
          if (_previous !== undefined && _previous !== kNotFound) {
            return _previous;
          }
          if (m.method && m.method !== event.req.method) {
            return;
          }
          return m.handler(event);
        });
      }
    }

    // 3. Middleware router
    const _mRouter = this.#mRouter;
    if (_mRouter) {
      const matches = findAllRoutes(_mRouter, event.req.method, pathname);
      if (matches.length > 0) {
        _chain = _chain || Promise.resolve();
        for (const match of matches) {
          _chain = _chain.then((_previous) => {
            if (_previous !== undefined && _previous !== kNotFound) {
              return _previous;
            }
            event.context.params = match.params;
            event.context.matchedRoute = match.data;
            return match.data.handler(event);
          });
        }
      }
    }

    // 4. Route handler
    if (this.#router) {
      const match = findRoute(this.#router, event.req.method, pathname);
      if (match) {
        if (_chain) {
          return _chain.then((_previous) => {
            if (_previous !== undefined && _previous !== kNotFound) {
              return _previous;
            }
            event.context.params = match.params;
            event.context.matchedRoute = match.data;
            return match.data.handler(event);
          });
        } else {
          event.context.params = match.params;
          event.context.matchedRoute = match.data;
          return match.data.handler(event);
        }
      }
    }

    // 5. 404
    return _chain
      ? _chain.then((_previous) =>
          _previous === undefined ? kNotFound : _previous,
        )
      : kNotFound;
  }

  /**
   * Resolve a route handler by method and path.
   */
  async resolve(
    method: HTTPMethod,
    path: string,
  ): Promise<ResolvedEventHandler | undefined> {
    const match =
      (this.#mRouter && findRoute(this.#mRouter, method, path)) ||
      (this.#router && findRoute(this.#router, method, path));

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
    addRoute(this.#router, _method, route, <H3Route>{
      method: _method,
      route,
      handler: _handler,
    });
    return this;
  }

  /**
   * Register a global middleware
   *
   * Global middleware will be called before all routes on each request.
   *
   * If the first argument is a string, it will be used as the route.
   */
  use(
    arg1: string | EventHandler | H3 | H3Route,
    arg2?: EventHandler | H3 | Partial<H3Route>,
    arg3?: Partial<H3Route>,
  ): this {
    const arg1T = typeof arg1;
    const entry = {} as H3Route;
    let _handler: EventHandler | H3;
    if (arg1T === "string") {
      // (route, handler, details)
      entry.route = (arg1 as string) || arg3?.route;
      entry.method = arg3?.method as HTTPMethod;
      _handler = (arg2 as EventHandler | H3) || arg3?.handler;
    } else if (arg1T === "function") {
      // (handler, details)
      entry.route = (arg2 as H3Route)?.route;
      entry.method = (arg2 as H3Route)?.method;
      _handler = (arg1 as EventHandler | H3) || (arg2 as H3Route)?.handler;
    } else {
      // (details)
      entry.route = (arg1 as H3Route).route;
      entry.method = (arg1 as H3Route).method;
      _handler = (arg1 as H3Route).handler;
    }

    entry.handler = (_handler as H3)?.handler || _handler;
    entry.method = (entry.method || "").toUpperCase() as HTTPMethod;

    if (entry.route) {
      // Routed middleware/handler
      if (!this.#mRouter) {
        this.#mRouter = createRouter();
      }
      addRoute(this.#mRouter, entry.method, entry.route, entry);
    } else {
      // Global middleware
      if (!this.#middleware) {
        this.#middleware = [];
      }
      this.#middleware.push(entry);
    }
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
