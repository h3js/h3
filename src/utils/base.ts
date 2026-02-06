import type { EventHandler, HTTPHandler } from "../types/handler.ts";
import { toEventHandler } from "../handler.ts";
import { withoutBase, withoutTrailingSlash } from "./internal/path.ts";

/**
 * Returns a new event handler that removes the base url of the event before calling the original handler.
 *
 * @example
 * const api = new H3()
 *  .get("/", () => "Hello API!");
 * const app = new H3();
 *  .use("/api/**", withBase("/api", api.handler));
 *
 * @param base The base path to prefix.
 * @param handler The event handler to use with the adapted path.
 */
export function withBase(base: string, input: HTTPHandler): EventHandler {
  base = withoutTrailingSlash(base);

  const handler = toEventHandler(input);
  if (!handler) {
    throw new Error("Invalid handler", { cause: input });
  }

  return async function _handlerWithBase(event) {
    const _pathBefore = event.url.pathname || "/";
    event.url.pathname = withoutBase(event.url.pathname || "/", base);
    try {
      return await handler(event);
    } finally {
      event.url.pathname = _pathBefore;
    }
  };
}
