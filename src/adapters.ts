import { toNodeHandler as _toNodeHandler } from "srvx/node";
import { HTTPError } from "./error.ts";
import { kHandled } from "./response.ts";

import type {
  NodeServerRequest,
  NodeServerResponse,
  ServerRequest,
} from "srvx";
import type { H3 } from "./h3.ts";
import type { H3EventContext } from "./types/context.ts";
import type { EventHandler, EventHandlerResponse } from "./types/handler.ts";
import type { H3Event } from "./event.ts";

export type NodeHandler = (
  req: NodeServerRequest,
  res: NodeServerResponse,
) => unknown | Promise<unknown>;

export type NodeMiddleware = (
  req: NodeServerRequest,
  res: NodeServerResponse,
  next: (error?: Error) => void,
) => unknown | Promise<unknown>;

/**
 * @deprecated Since h3 v2 you can directly use `app.fetch(request, init?, context?)`
 */
export function toWebHandler(
  app: H3,
): (request: ServerRequest, context?: H3Event) => Promise<Response> {
  return (request, context) => {
    return Promise.resolve(app.request(request, undefined, context));
  };
}

export function fromWebHandler(
  handler: (
    request: ServerRequest,
    context?: H3EventContext,
  ) => Promise<Response>,
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

export function defineNodeHandler(handler: NodeHandler): NodeHandler {
  return handler;
}

export function defineNodeMiddleware(handler: NodeMiddleware): NodeMiddleware {
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
  req: NodeServerRequest,
  res: NodeServerResponse,
) {
  const isMiddleware = handler.length > 2;
  return new Promise((resolve, reject) => {
    res.once("close", () => resolve(kHandled));
    res.once("finish", () => resolve(kHandled));
    res.once("pipe", (stream) => resolve(stream));
    res.once("error", (error) => reject(error));
    try {
      if (isMiddleware) {
        Promise.resolve(
          handler(req, res, (error) =>
            error
              ? reject(new HTTPError({ cause: error, unhandled: true }))
              : resolve(void 0),
          ),
        ).catch((error) =>
          reject(new HTTPError({ cause: error, unhandled: true })),
        );
      } else {
        return Promise.resolve((handler as NodeHandler)(req, res))
          .then(() => resolve(kHandled))
          .catch((error) =>
            reject(new HTTPError({ cause: error, unhandled: true })),
          );
      }
    } catch (error: unknown) {
      reject(new HTTPError({ cause: error, unhandled: true }));
    }
  });
}
