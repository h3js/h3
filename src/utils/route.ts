import { withoutTrailingSlash, withoutBase } from "ufo";
import { EventHandler } from "../types";
import { eventHandler } from "../event";

export function useBase(base: string, handler: EventHandler): EventHandler {
  base = withoutTrailingSlash(base);

  if (!base || base === "/") {
    return handler;
  }

  return eventHandler(async (event) => {
    // Keep original incoming url accessable
    (event.node.req as { originalUrl?: string }).originalUrl =
      (event.node.req as { originalUrl?: string }).originalUrl ||
      event.node.req.url ||
      "/";

    const _path = event._path || event.node.req.url || "/";

    event._path = withoutBase(event.path || "/", base);
    event.node.req.url = event._path;

    try {
      return await handler(event);
    } finally {
      event._path = event.node.req.url = _path;
    }
  });
}
