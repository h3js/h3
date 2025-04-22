import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler as _toNodeHandler } from "srvx/node";
import { createError } from "./error.ts";
import { kHandled } from "./response.ts";

import type { H3 } from "./h3.ts";
import type { H3Event, H3EventContext } from "./types/event.ts";
import type { EventHandler, EventHandlerResponse } from "./types/handler.ts";

export type NodeHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => unknown | Promise<unknown>;

export type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: Error) => void,
) => unknown | Promise<unknown>;

/**
 * @deprecated Since h3 v2 you can directly use `app.fetch(request, init?, context?)`
 */
export function toWebHandler(
  app: H3,
): (request: Request, context?: H3Event) => Promise<Response> {
  return (request, context) => {
    return Promise.resolve(app.fetch(request, undefined, context));
  };
}

export function fromWebHandler(
  handler: (request: Request, context?: H3EventContext) => Promise<Response>,
): EventHandler {
  return (event) => handler(event.req, event.context);
}

/**
 * Convert a Node.js handler function (req, res, next?) to an EventHandler.
 *
 * **Note:** The returned event handler requires to be executed with h3 Node.js handler.
 */
export function fromNodeHandler(handler: NodeMiddleware): EventHandler;
export function fromNodeHandler(handler: NodeHandler): EventHandler;
export function fromNodeHandler(
  handler: NodeHandler | NodeMiddleware,
): EventHandler {
  if (typeof handler !== "function") {
    throw new TypeError(`Invalid handler. It should be a function: ${handler}`);
  }
  return (event) => {
    if (!event.runtime?.node?.res) {
      throw new Error(
        "[h3] Executing Node.js middleware is not supported in this server!",
      );
    }
    return callNodeHandler(
      handler,
      event.runtime?.node.req,
      event.runtime?.node.res,
    ) as EventHandlerResponse;
  };
}

export function defineNodeHandler(handler: NodeHandler) {
  return handler;
}

export function defineNodeMiddleware(handler: NodeMiddleware) {
  return handler;
}

/**
 * Convert H3 app instance to a NodeHandler with (IncomingMessage, ServerResponse) => void signature.
 */
export function toNodeHandler(app: H3): NodeHandler {
  return _toNodeHandler(app.fetch);
}

function callNodeHandler(
  handler: NodeHandler | NodeMiddleware,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const isMiddleware = handler.length > 2;
  return new Promise((resolve, reject) => {
    res.once("close", () => resolve(kHandled));
    res.once("finish", () => resolve(kHandled));
    res.once("pipe", () => resolve(kHandled));
    res.once("error", (error) => reject(error));
    try {
      if (isMiddleware) {
        Promise.resolve(
          handler(req, res, (err) =>
            err ? reject(createError(err)) : resolve(void 0),
          ),
        ).catch((error) => reject(createError(error)));
      } else {
        return Promise.resolve((handler as NodeHandler)(req, res))
          .then(() => resolve(kHandled))
          .catch((error) => reject(createError(error)));
      }
    } catch (error: any) {
      reject(createError(error));
    }
  });
}
