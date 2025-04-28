import type {
  IncomingMessage as NodeIncomingMessage,
  ServerResponse as NodeServerResponse,
} from "node:http";
import { App } from "../app";
import { createError, isError, sendError } from "../error";
import { createEvent, eventHandler, isEventHandler } from "../event";
import { EventHandler, EventHandlerResponse } from "../types";
import { setResponseStatus } from "../utils";

// Node.js
export type {
  IncomingMessage as NodeIncomingMessage,
  ServerResponse as NodeServerResponse,
} from "node:http";
export type NodeListener = (
  req: NodeIncomingMessage,
  res: NodeServerResponse,
) => void;
export type NodePromisifiedHandler = (
  req: NodeIncomingMessage,
  res: NodeServerResponse,
) => Promise<any>;
export type NodeMiddleware = (
  req: NodeIncomingMessage,
  res: NodeServerResponse,
  next: (err?: Error) => any,
) => any;

export const defineNodeListener = (handler: NodeListener) => handler;

export const defineNodeMiddleware = (middleware: NodeMiddleware) => middleware;

export function fromNodeMiddleware(
  handler: NodeListener | NodeMiddleware,
): EventHandler {
  if (isEventHandler(handler)) {
    return handler;
  }
  if (typeof handler !== "function") {
    throw new (TypeError as any)(
      "Invalid handler. It should be a function:",
      handler,
    );
  }
  return eventHandler((event) => {
    return callNodeListener(
      handler,
      event.node.req as NodeIncomingMessage,
      event.node.res,
    ) as EventHandlerResponse;
  });
}

export function toNodeListener(app: App): NodeListener {
  const toNodeHandle: NodeListener = async function (req, res) {
    const event = createEvent(req, res);
    try {
      await app.handler(event);
    } catch (_error: any) {
      const error = createError(_error);
      if (!isError(_error)) {
        error.unhandled = true;
      }

      // #754 Make sure hooks see correct status code and message
      setResponseStatus(event, error.statusCode, error.statusMessage);

      if (app.options.onBeforeResponse && !event._onBeforeResponseCalled) {
        await app.options.onBeforeResponse(event, { body: error });
      }
      if (app.options.onError) {
        await app.options.onError(error, event);
      }
      if (error.unhandled || error.fatal) {
        console.error("[h3]", error.fatal ? "[fatal]" : "[unhandled]", error);
      }
      if (!event.handled) {
        await sendError(event, error, !!app.options.debug);
      }
      if (app.options.onAfterResponse && !event._onAfterResponseCalled) {
        await app.options.onAfterResponse(event, { body: error });
      }
    }
  };
  return toNodeHandle;
}

export function promisifyNodeListener(
  handler: NodeListener | NodeMiddleware,
): NodePromisifiedHandler {
  return function (req: NodeIncomingMessage, res: NodeServerResponse) {
    return callNodeListener(handler, req, res);
  };
}

export function callNodeListener(
  handler: NodeMiddleware,
  req: NodeIncomingMessage,
  res: NodeServerResponse,
) {
  const isMiddleware = handler.length > 2;
  return new Promise((resolve, reject) => {
    const next = (err?: Error) => {
      if (isMiddleware) {
        res.off("close", next);
        res.off("error", next);
      }
      return err ? reject(createError(err)) : resolve(undefined);
    };
    try {
      const returned = handler(req, res, next);
      if (isMiddleware && returned === undefined) {
        res.once("close", next);
        res.once("error", next);
      } else {
        resolve(returned);
      }
    } catch (error) {
      next(error as Error);
    }
  });
}
