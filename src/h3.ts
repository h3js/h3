import { createRouter, addRoute, findRoute } from "rou3";
import { H3Event } from "./event.ts";
import { toResponse, kNotFound } from "./response.ts";
import { callMiddleware, normalizeMiddleware } from "./middleware.ts";

import type { ServerRequest } from "srvx";
import type {
  H3Config,
  H3CoreConfig,
  H3Plugin,
  MatchedRoute,
  RouterContext,
} from "./types/h3.ts";
import type { H3EventContext } from "./types/context.ts";
import type {
  EventHandler,
  FetchableObject,
  FetchHandler,
  HTTPHandler,
  Middleware,
} from "./types/handler.ts";
import type {
  H3Route,
  HTTPMethod,
  H3 as H3Type,
  H3Core as H3CoreType,
  RouteOptions,
  MiddlewareOptions,
} from "./types/h3.ts";

import { toRequest } from "./utils/request.ts";
import { toEventHandler } from "./handler.ts";
import type { RouteParams } from "./types/_utils.ts";

export const NoHandler: EventHandler = () => kNotFound;

export class H3Core implements H3CoreType {
  readonly config: H3CoreConfig;

  "~middleware": Middleware[];
  "~routes": H3Route[] = [];

  constructor(config: H3CoreConfig = {}) {
    this["~middleware"] = [];
    this.config = config;
    this.fetch = this.fetch.bind(this);
    this.handler = this.handler.bind(this);
  }

  fetch(request: ServerRequest): Response | Promise<Response> {
    return this["~request"](request);
  }

  handler(event: H3Event): unknown | Promise<unknown> {
    const route = this["~findRoute"](event);
    if (route) {
      event.context.params = route.params;
      event.context.matchedRoute = route.data;
    }
    const routeHandler = route?.data.handler || NoHandler;
    const middleware = this["~getMiddleware"](
      event,
      route as unknown as undefined,
    );
    return middleware.length > 0
      ? callMiddleware(event, middleware, routeHandler)
      : routeHandler(event);
  }

  "~request"(
    request: ServerRequest,
    context?: H3EventContext,
  ): Response | Promise<Response> {
    // Create a new event instance
    const event = new H3Event(request, context, this as unknown as H3Type);

    // Execute the handler
    let handlerRes: unknown | Promise<unknown>;
    try {
      if (this.config.onRequest) {
        const hookRes = this.config.onRequest(event);
        handlerRes =
          typeof hookRes?.then === "function"
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

  "~findRoute"(_event: H3Event): MatchedRoute<H3Route> | void {}

  "~addRoute"(_route: H3Route): void {
    this["~routes"].push(_route);
  }

  "~getMiddleware"(
    _event: H3Event,
    route: MatchedRoute<H3Route> | undefined,
  ): Middleware[] {
    const routeMiddleware = route?.data.middleware;
    const globalMiddleware = this["~middleware"];
    return routeMiddleware
      ? [...globalMiddleware, ...routeMiddleware]
      : globalMiddleware;
  }
}

export const H3 = /* @__PURE__ */ (() => {
  class H3 extends H3Core {
    "~rou3": RouterContext;

    constructor(config: H3Config = {}) {
      super(config);
      this["~rou3"] = createRouter();
      this.request = this.request.bind(this);
      config.plugins?.forEach((plugin) => plugin(this as unknown as H3Type));
    }

    register(plugin: H3Plugin) {
      plugin(this as unknown as H3Type);
      return this;
    }

    request(
      _req: ServerRequest | URL | string,
      _init?: RequestInit,
      context?: H3EventContext,
    ): Response | Promise<Response> {
      return this["~request"](toRequest(_req, _init), context);
    }

    mount(base: string, input: FetchHandler | FetchableObject | H3Type) {
      if ("handler" in input) {
        if (input["~middleware"].length > 0) {
          this["~middleware"].push((event, next) => {
            const originalPathname = event.url.pathname;
            if (!originalPathname.startsWith(base)) {
              return next();
            }
            event.url.pathname = event.url.pathname.slice(base.length) || "/";
            return callMiddleware(event, input["~middleware"], () => {
              event.url.pathname = originalPathname;
              return next();
            });
          });
        }
        for (const r of input["~routes"]) {
          this["~addRoute"]({
            ...r,
            route: base + r.route,
          });
        }
      } else {
        const fetchHandler = "fetch" in input ? input.fetch : input;
        this.all(`${base}/**`, function _mountedMiddleware(event) {
          const url = new URL(event.url);
          url.pathname = url.pathname.slice(base.length) || "/";
          return fetchHandler(new Request(url, event.req));
        });
      }
      return this;
    }

    on<Route extends string>(
      method: HTTPMethod | Lowercase<HTTPMethod> | "",
      route: Route,
      handler: EventHandler<{
        routerParams: RouteParams<Route>;
      }>,
      opts?: RouteOptions,
    ): this;
    on(
      method: HTTPMethod | Lowercase<HTTPMethod> | "",
      route: string,
      handler: HTTPHandler,
      opts?: RouteOptions,
    ): this;
    on<Route extends string>(
      method: HTTPMethod | Lowercase<HTTPMethod> | "",
      route: Route | string,
      handler:
        | EventHandler<{
            routerParams: RouteParams<Route>;
          }>
        | HTTPHandler,
      opts?: RouteOptions,
    ): this {
      const _method = (method || "").toUpperCase();
      route = new URL(route, "http://_").pathname;
      this["~addRoute"]({
        method: _method as HTTPMethod,
        route,
        handler: toEventHandler(handler as HTTPHandler)!,
        middleware: opts?.middleware,
        meta: { ...(handler as EventHandler).meta, ...opts?.meta },
      });
      return this;
    }

    all(route: string, handler: EventHandler, opts?: RouteOptions) {
      return this.on("", route, handler, opts);
    }

    override "~findRoute"(_event: H3Event): MatchedRoute<H3Route> | void {
      return findRoute(this["~rou3"], _event.req.method, _event.url.pathname);
    }

    override "~addRoute"(_route: H3Route): void {
      addRoute(this["~rou3"], _route.method, _route.route!, _route);
      super["~addRoute"](_route);
    }

    use(arg1: unknown, arg2?: unknown, arg3?: unknown): this {
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
      this["~middleware"].push(
        normalizeMiddleware(fn as Middleware, { ...opts, route }),
      );
      return this;
    }
  }

  // prettier-ignore
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE"] as const) {
    (H3Core as any).prototype[method.toLowerCase()] = function (
      this: H3Type,
      route: string,
      handler: EventHandler,
      opts?: RouteOptions,
    ) {
      return this.on(method, route, handler, opts);
    };
  }

  return H3;
})() as unknown as { new (config?: H3Config): H3Type };

export type H3 = H3Type;
