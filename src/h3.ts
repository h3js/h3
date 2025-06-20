import { createRouter, addRoute, findRoute } from "rou3";
import { H3Event } from "./event.ts";
import { toResponse, kNotFound } from "./response.ts";
import { callMiddleware, normalizeMiddleware } from "./middleware.ts";

import type { RouterContext } from "rou3";
import type {
  FetchHandler,
  H3Config,
  H3Plugin,
  H3RouteMeta,
} from "./types/h3.ts";
import type { H3EventContext } from "./types/context.ts";
import type { EventHandler, Middleware } from "./types/handler.ts";
import type {
  H3Route,
  HTTPMethod,
  H3 as H3Type,
  RouteOptions,
  RouteHandler,
  MiddlewareOptions,
} from "./types/h3.ts";
import type { ServerRequest } from "srvx";

export type H3 = H3Type;

export const H3 = /* @__PURE__ */ (() => {
  // prettier-ignore
  const HTTPMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE" ] as const;

  class H3 implements Omit<H3Type, Lowercase<(typeof HTTPMethods)[number]>> {
    _middleware: Middleware[];
    _routes?: RouterContext<H3Route>;

    readonly config: H3Config;

    constructor(config: H3Config = {}) {
      this._middleware = [];
      this.config = config;
      this.fetch = this.fetch.bind(this);
      this._fetch = this._fetch.bind(this);
      this.handler = this.handler.bind(this);
      config.plugins?.forEach((plugin) => plugin(this as unknown as H3Type));
    }

    fetch(
      request: ServerRequest | URL | string,
      options?: RequestInit,
    ): Promise<Response> {
      try {
        return Promise.resolve(this._fetch(request, options));
      } catch (error: any) {
        return Promise.reject(error);
      }
    }

    _fetch(
      _req: ServerRequest | URL | string,
      _init?: RequestInit,
      context?: H3EventContext,
    ): Response | Promise<Response> {
      // Convert the request to a Request object
      const request: ServerRequest = toRequest(_req, _init);

      // Create a new event instance
      const event = new H3Event(request, context);

      // Execute the handler
      let handlerRes: unknown | Promise<unknown>;
      try {
        if (this.config.onRequest) {
          const hookRes = this.config.onRequest(event);
          handlerRes =
            hookRes instanceof Promise
              ? hookRes.then(() => this.handler(event))
              : this.handler(event);
        } else {
          handlerRes = this.handler(event);
        }
      } catch (error: any) {
        handlerRes = Promise.reject(error);
      }

      // Prepare response
      return toResponse(handlerRes, event, this.config);
    }

    register(plugin: H3Plugin): H3Type {
      plugin(this as unknown as H3Type);
      return this as unknown as H3Type;
    }

    handler(event: H3Event): unknown | Promise<unknown> {
      const route = this._routes
        ? findRoute(this._routes, event.req.method, event.url.pathname)
        : undefined;
      if (route) {
        event.context.params = route.params;
        event.context.matchedRoute = route.data;
      }
      const middleware = route?.data.middleware
        ? [...this._middleware, ...route.data.middleware]
        : this._middleware;
      return callMiddleware(event, middleware, () => {
        return route ? route.data.handler(event) : kNotFound;
      });
    }

    mount(base: string, input: FetchHandler | { fetch: FetchHandler }): H3Type {
      const fetchHandler = "fetch" in input ? input.fetch : input;
      this.all(`${base}/**`, (event) => {
        const url = new URL(event.url);
        url.pathname = url.pathname.slice(base.length) || "/";
        return fetchHandler(new Request(url, event.req));
      });
      return this as unknown as H3Type;
    }

    all(route: string, handler: RouteHandler, opts?: RouteOptions): H3Type {
      return this.on("", route, handler, opts);
    }

    on(
      method: HTTPMethod | Lowercase<HTTPMethod> | "",
      route: string,
      handler: RouteHandler,
      opts?: RouteOptions,
    ): H3Type {
      if (!this._routes) {
        this._routes = createRouter();
      }
      const _method = (method || "").toUpperCase();
      let _handler: EventHandler;
      let meta: H3RouteMeta | undefined = opts?.meta;
      if ((handler as H3Type).handler) {
        _handler = (handler as H3Type).handler;
      } else {
        _handler = handler as EventHandler;
        meta = { ...(handler as EventHandler).meta, ...opts?.meta };
      }
      route = new URL(route, "h://_").pathname;
      addRoute(this._routes, _method, route, {
        method: _method as HTTPMethod,
        route,
        handler: _handler,
        middleware: opts?.middleware,
        meta,
      } satisfies H3Route);
      return this as unknown as H3Type;
    }

    use(arg1: unknown, arg2?: unknown, arg3?: unknown): H3Type {
      let route: string | undefined;
      let fn: Middleware | H3Type;
      let opts: MiddlewareOptions | undefined;
      if (typeof arg1 === "string") {
        route = arg1;
        fn = arg2 as Middleware | H3Type;
        opts = arg3 as MiddlewareOptions;
      } else {
        fn = arg1 as Middleware | H3Type;
        opts = arg2 as MiddlewareOptions;
      }
      this._middleware.push(
        normalizeMiddleware(fn, route ? { ...opts, route } : opts),
      );
      return this as unknown as H3Type;
    }
  }

  for (const method of HTTPMethods) {
    (H3 as any).prototype[method.toLowerCase()] = function (
      this: H3Type,
      route: string,
      handler: EventHandler | H3Type,
      opts?: RouteOptions,
    ) {
      return this.on(method, route, handler, opts);
    };
  }

  return H3;
})() as unknown as typeof H3Type;

export function toRequest(
  _request: ServerRequest | URL | string,
  _init?: RequestInit,
): ServerRequest {
  if (typeof _request === "string") {
    let url = _request;
    if (url[0] === "/") {
      const headers = _init?.headers ? new Headers(_init.headers) : undefined;
      const host = headers?.get("host") || "localhost";
      const proto =
        headers?.get("x-forwarded-proto") === "https" ? "https" : "http";
      url = `${proto}://${host}${url}`;
    }
    return new Request(url, _init);
  } else if (_init || _request instanceof URL) {
    return new Request(_request, _init);
  }
  return _request;
}
