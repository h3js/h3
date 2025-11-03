import { routeToRegExp } from "rou3";
import { kNotFound } from "./response.ts";

import type { H3Event } from "./event.ts";
import type { MiddlewareOptions } from "./types/h3.ts";
import type {
  EventHandler,
  FetchableObject,
  HTTPHandler,
  Middleware,
} from "./types/handler.ts";
import type { H3Core } from "./h3.ts";

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
  return function _middlewareMatcher(event: H3Event) {
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

  let nextCalled: undefined | boolean;
  let nextResult: unknown;

  const next = () => {
    if (nextCalled) {
      return nextResult;
    }
    nextCalled = true;
    nextResult = callMiddleware(event, middleware, handler, index + 1);
    return nextResult;
  };

  const ret = fn(event, next);
  return isUnhandledResponse(ret)
    ? next()
    : typeof (ret as PromiseLike<unknown>)?.then === "function"
      ? (ret as PromiseLike<unknown>).then((resolved) =>
          isUnhandledResponse(resolved) ? next() : resolved,
        )
      : ret;
}

function isUnhandledResponse(val: unknown) {
  return val === undefined || val === kNotFound;
}

/**
 * Converts any HTTPHandler or Middleware into Middleware.
 *
 * If FetchableObject or Handler returns a Response with 404 status, the next middleware will be called.
 */
export function toMiddleware(
  input: HTTPHandler | Middleware | undefined,
): Middleware {
  let h = (input as H3Core).handler || (input as EventHandler | Middleware);
  let isFunction: boolean = typeof h === "function";
  if (!isFunction && typeof (input as FetchableObject)?.fetch === "function") {
    isFunction = true;
    h = function _fetchHandler(event: H3Event) {
      return (input as FetchableObject).fetch!(event.req);
    };
  }
  if (!isFunction) {
    return function noopMiddleware(event, next) {
      return next();
    };
  }
  if (h.length === 2) {
    return h as Middleware;
  }
  return function _middlewareHandler(event, next) {
    const res = h(event);
    return typeof (res as Promise<any>)?.then === "function"
      ? (res as Promise<any>).then((r) => {
          return is404(r) ? next() : r;
        })
      : is404(res)
        ? next()
        : res;
  };
}

function is404(val: unknown): boolean {
  return (
    isUnhandledResponse(val) ||
    ((val as Response)?.status === 404 && val instanceof Response)
  );
}
