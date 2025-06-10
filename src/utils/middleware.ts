import { HTTPError } from "../error.ts";
import { handleResponse } from "../response.ts";
import type { MaybePromise } from "../types/_utils.ts";

import type { H3Event } from "../types/event.ts";
import type { Middleware } from "../types/handler.ts";

/**
 * Define a middleware that runs on each request.
 */
export function onRequest(
  hook: (event: H3Event) => void | Promise<void>,
): Middleware {
  return async (event) => {
    await hook(event);
  };
}

/**
 * Define a middleware that runs after Response is generated.
 *
 * You can return a new Response from the handler to replace the original response.
 */
export function onResponse(
  hook: (response: Response, event: H3Event) => MaybePromise<void | Response>,
): Middleware {
  return async (event, next) => {
    const rawBody = await next();
    const response = await handleResponse(rawBody, event);
    const hookResponse = await hook(response, event);
    return hookResponse || response;
  };
}

/**
 * Define a middleware that runs when an error occurs.
 *
 * You can return a new Response from the handler to gracefully handle the error.
 */
export function onError(
  hook: (error: HTTPError, event: H3Event) => MaybePromise<void | unknown>,
): Middleware {
  return async (event, next) => {
    try {
      return await next();
    } catch (rawError: any) {
      const isHTTPError = HTTPError.isError(rawError);
      const error = isHTTPError
        ? (rawError as HTTPError)
        : new HTTPError(rawError);
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
