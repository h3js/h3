import { createRouter, addRoute, findRoute } from "rou3";
import { serve as srvxServe } from "srvx";
import { H3Event } from "./event.ts";
import { handleResponse, kNotFound } from "./response.ts";
import { callMiddleware, defineMiddleware } from "./middleware.ts";

import type { ServerOptions, Server } from "srvx";
import type { RouterContext } from "rou3";
import type { H3Route, HTTPMethod, H3 as H3Type } from "./types/h3.ts";
import type { H3Config } from "./types/h3.ts";
import type { H3EventContext } from "./types/event.ts";
import type {
  EventHandler,
  Middleware,
  MiddlewareOptions,
} from "./types/handler.ts";

export type H3 = H3Type;

/**
 * Serve the h3 app, automatically handles current runtime behavior.
 */
export function serve(app: H3, options?: Omit<ServerOptions, "fetch">): Server {
  return srvxServe({ fetch: app.fetch, ...options });
}

export const H3 = /* @__PURE__ */ (() => {
  // prettier-ignore
  const HTTPMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE" ] as const;

  class H3 implements Omit<H3Type, Lowercase<(typeof HTTPMethods)[number]>> {
    #middleware: Middleware[];
    #router?: RouterContext<H3Route>;
    readonly config: H3Config;

    constructor(config: H3Config = {}) {
      this.#middleware = [];
      this.config = config;
      this.fetch = this.fetch.bind(this);
      this.handler = this.handler.bind(this);
    }

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
      return handleResponse(handlerRes, event, this.config);
    }

    handler(event: H3Event): unknown | Promise<unknown> {
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

    all(route: string, handler: EventHandler | H3Type): H3Type {
      return this.on("", route, handler);
    }

    on(
      method: HTTPMethod | Lowercase<HTTPMethod> | "",
      route: string,
      handler: EventHandler | H3Type,
    ): H3Type {
      if (!this.#router) {
        this.#router = createRouter();
      }
      const _method = (method || "").toUpperCase();
      const _handler = (handler as H3Type)?.handler || handler;
      addRoute(this.#router, _method, route, {
        method: _method as HTTPMethod,
        route,
        handler: _handler,
      } satisfies H3Route);
      return this as unknown as H3Type;
    }

    use(input: Middleware | H3Type, opts?: MiddlewareOptions): H3Type {
      this.#middleware.push(defineMiddleware(input, opts));
      return this as unknown as H3Type;
    }
  }

  for (const method of HTTPMethods) {
    (H3 as any).prototype[method.toLowerCase()] = function (
      this: H3Type,
      route: string,
      handler: EventHandler | H3Type,
    ) {
      return this.on(method, route, handler);
    };
  }

  return H3;
})() as unknown as typeof H3Type;

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
