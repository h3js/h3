import type { H3 } from "../h3.ts";
import type { EventHandler } from "../types/handler.ts";
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
export function withBase(base: string, input: EventHandler | H3): EventHandler {
  base = withoutTrailingSlash(base);

  const _originalHandler = (input as H3)?.handler || (input as EventHandler);

  const _handler: EventHandler = async (event) => {
    const _pathBefore = event.url.pathname || "/";
    event.url.pathname = withoutBase(event.url.pathname || "/", base);
    return Promise.resolve(_originalHandler(event)).finally(() => {
      event.url.pathname = _pathBefore;
    });
  };

  return _handler;
}
