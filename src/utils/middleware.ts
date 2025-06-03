import type { H3Error } from "../error.ts";
import type { H3Event } from "../types/event.ts";
import type { Middleware } from "../types/handler.ts";

/**
 * Define a middleware that runs on each request.
 */
export function onRequest(
  handler: (event: H3Event) => void | Promise<void>,
): Middleware {
  return async (event) => {
    await handler(event);
  };
}

/**
 * Define a middleware that runs after Response is generated.
 */
export function onResponse(
  handler: (event: H3Event, res: { body: any }) => void | Promise<void>,
): Middleware {
  return async (event, next) => {
    const body = await next();
    await handler(event, { body });
    return body;
  };
}

/**
 * Define a middleware that runs when an error occurs.
 */
export function onError(
  handler: (event: H3Event, error: Error | H3Error) => void | Promise<void>,
): Middleware {
  return async (event, next) => {
    try {
      return await next();
    } catch (error) {
      await handler(event, error as Error | H3Error);
      throw error;
    }
  };
}
