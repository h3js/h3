import { routeToRegExp } from "rou3";
import { kNotFound } from "./response.ts";

import type { H3Event } from "./event.ts";
import type { MiddlewareOptions } from "./types/h3.ts";
import type { EventHandler, Middleware } from "./types/handler.ts";

export function defineMiddleware(input: Middleware): Middleware {
  return input;
}

export function normalizeMiddleware(
  input: Middleware,
  opts: MiddlewareOptions & { route?: string } = {},
): Middleware {
  const matcher = createMatcher(opts);
  if (
    !matcher &&
    (input.length > 1 || input.constructor?.name === "AsyncFunction")
  ) {
    return input; // Fast path: async or with explicit next() and no matcher filters
  }
  return (event, next) => {
    if (matcher && !matcher(event)) {
      return next();
    }
    const res = input(event, next);
    return res === undefined || res === kNotFound ? next() : res;
  };
}

function createMatcher(opts: MiddlewareOptions & { route?: string }) {
  if (!opts.route && !opts.method && !opts.match) {
    return undefined;
  }
  const routeMatcher = opts.route ? routeToRegExp(opts.route) : undefined;
  const method = opts.method?.toUpperCase();
  return (event: H3Event) => {
    if (method && event.req.method !== method) {
      return false;
    }
    if (opts.match && !opts.match(event)) {
      return false;
    }
    if (!routeMatcher) {
      return true;
    }
    const match = event.url.pathname.match(routeMatcher);
    if (!match) {
      return false;
    }
    if (match.groups) {
      event.context.middlewareParams = {
        ...event.context.middlewareParams,
        ...match.groups,
      };
    }
    return true;
  };
}

export function callMiddleware(
  event: H3Event,
  middleware: Middleware[],
  handler: EventHandler,
  index: number = 0,
): unknown | Promise<unknown> {
  if (index === middleware.length) {
    return handler(event);
  }
  const fn = middleware[index];
  const next = () => callMiddleware(event, middleware, handler, index + 1);
  const ret = fn(event, next);
  return ret === undefined || ret === kNotFound
    ? next()
    : ret instanceof Promise
      ? ret.then((resolved) =>
          resolved === undefined || resolved === kNotFound ? next() : resolved,
        )
      : ret;
}
