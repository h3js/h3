import { HTTPError } from "../error.ts";
import { toResponse } from "../response.ts";
import type { MaybePromise } from "../types/_utils.ts";

import type { H3Event } from "../event.ts";
import type { Middleware } from "../types/handler.ts";
import { assertBodySize } from "./body.ts";

/**
 * Define a middleware that runs on each request.
 */
export function onRequest(hook: (event: H3Event) => MaybePromise<void>): Middleware {
  return async function _onRequestMiddleware(event) {
    await hook(event);
  };
}

/**
 * Define a middleware that runs after Response is generated.
 *
 * You can return a new Response from the handler to replace the original response.
 */
export function onResponse(hook: (response: Response, event: H3Event) => unknown): Middleware {
  return async function _onResponseMiddleware(event, next) {
    const rawBody = await next();
    const response = await toResponse(rawBody, event);
    const hookResponse = await hook(response, event);
    return hookResponse || response;
  };
}

/**
 * Define a middleware that runs when an error occurs.
 *
 * You can return a new Response from the handler to gracefully handle the error.
 */
export function onError(hook: (error: HTTPError, event: H3Event) => unknown): Middleware {
  return async (event, next) => {
    try {
      return await next();
    } catch (rawError: any) {
      const isHTTPError = HTTPError.isError(rawError);
      const error = isHTTPError ? (rawError as HTTPError) : new HTTPError(rawError);
      if (!isHTTPError) {
        // @ts-expect-error unhandled is readonly for public interface
        error.unhandled = true;
        if (rawError?.stack) {
          error.stack = rawError.stack;
        }
      }
      const hookResponse = await hook(error, event);
      if (hookResponse !== undefined) {
        return hookResponse;
      }
      throw error;
    }
  };
}

/**
 * Define a middleware that limits the request body size to the specified limit.
 *
 * The limit is enforced as the body is read (see {@link assertBodySize}), so an
 * oversized body surfaces as a `413` Request Entity Too Large error when the
 * handler consumes it (an honest oversized `Content-Length` is still rejected
 * up-front). A body the handler never reads is not counted. If you need custom
 * handling, use `assertBodySize` directly.
 *
 * @param limit Body size limit in bytes
 * @see {assertBodySize}
 */
export function bodyLimit(limit: number): Middleware {
  return (event, next) => {
    assertBodySize(event, limit);
    return next();
  };
}
