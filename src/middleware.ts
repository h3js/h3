import { routeToRegExp } from "rou3";
import { kNotFound } from "./response.ts";

import type { H3 } from "./h3.ts";
import type { H3Event } from "./types/event.ts";
import type {
  EventHandler,
  Middleware,
  MiddlewareOptions,
} from "./types/handler.ts";

export function defineMiddleware(
  input: Middleware | H3,
  opts: MiddlewareOptions = {},
): Middleware {
  const fn: Middleware = normalizeMiddleware(input);
  if (!opts?.method && !opts?.route) {
    return fn;
  }
  const routeMatcher = opts?.route ? routeToRegExp(opts.route) : undefined;
  const method = opts?.method?.toUpperCase();
  const match: (event: H3Event) => boolean = (event) => {
    if (method && event.req.method !== method) {
      return false;
    }
    if (opts?.match && !opts.match(event)) {
      return false;
    }
    return routeMatcher ? routeMatcher.test(event.url.pathname) : true;
  };
  return Object.assign(fn, { match });
}

function normalizeMiddleware(input: Middleware | H3): Middleware {
  if (typeof input === "function") {
    if (input.length > 1 || input.constructor?.name === "AsyncFunction") {
      return input;
    }
    return (event, next) => {
      const res = input(event, next);
      return res === undefined ? next() : res;
    };
  }
  if (typeof (input as H3).handler === "function") {
    return (event, next) => {
      const res = (input as H3).handler(event);
      if (res === kNotFound) {
        return next();
      } else if (res instanceof Promise) {
        return res.then((resolved) =>
          resolved === kNotFound ? next() : resolved,
        );
      }
      return res === undefined ? next() : res;
    };
  }
  throw new Error(`Invalid middleware: ${input}`);
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
  if (fn.match && !fn.match(event)) {
    return callMiddleware(event, middleware, handler, index + 1);
  }
  const next = () => callMiddleware(event, middleware, handler, index + 1);
  const ret = fn(event, next);
  return ret === undefined
    ? next()
    : ret instanceof Promise
      ? ret.then((resolved) => (resolved === undefined ? next() : resolved))
      : ret;
}
