import { routeToRegExp } from "rou3";
import { kNotFound } from "./response.ts";

import type { H3 } from "./h3.ts";
import type { H3Event } from "./types/event.ts";
import type { EventHandler, Middleware } from "./types/handler.ts";

export function defineMiddleware(
  input: Middleware | H3,
  opts: { route?: string; method?: string } = {},
): Middleware {
  const fn: Middleware = normalizeMiddleware(input);
  if (opts?.method || opts?.route) {
    return fn;
  }
  // Wrap middleware with route/method matching
  const routeMatcher = opts?.route ? routeToRegExp(opts.route) : undefined;
  const method = opts?.method?.toUpperCase();
  const match: (event: H3Event) => boolean = (event) => {
    if (method && event.req.method !== method) {
      return false;
    }
    return routeMatcher ? routeMatcher.test(event.url.pathname) : true;
  };
  return fn.length > 1
    ? (event, next) => (match(event) ? fn(event, next) : undefined)
    : (event) => (match(event) ? (fn as any)(event) : undefined);
}

function normalizeMiddleware(input: Middleware | H3): Middleware {
  if (typeof input === "function") {
    if (input.length > 1 || input.constructor?.name === "AsyncFunction") {
      return input;
    }
    return (event, next) => {
      const res = input(event, next);
      if (res !== undefined) {
        return res;
      }
      console.warn("Middleware should return next() or a value.");
      return next();
    };
  }
  if (typeof (input as H3).handler === "function") {
    // Wrap H3 handler as a middleware
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
  const next = () => callMiddleware(event, middleware, handler, index + 1);
  const ret = fn(event, next);
  return ret === undefined
    ? next()
    : ret instanceof Promise
      ? ret.then((resolved) => (resolved === undefined ? next() : resolved))
      : ret;
}
