import type {
  EventHandler,
  LazyEventHandler,
  EventHandlerRequest,
  EventHandlerResponse,
  EventHandlerObject,
  _RequestMiddleware,
  _ResponseMiddleware,
} from "../types";
import { hasProp } from "../utils/internal/object";
import type { H3Event } from "./event";

type _EventHandlerHooks = {
  onRequest?: _RequestMiddleware[];
  onBeforeResponse?: _ResponseMiddleware[];
};

export function defineEventHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response = EventHandlerResponse,
>(
  handler:
    | EventHandler<Request, Response>
    | EventHandlerObject<Request, Response>,
): EventHandler<Request, Response>;
// TODO: remove when appropriate
// This signature provides backwards compatibility with previous signature where first generic was return type
export function defineEventHandler<
  Request = EventHandlerRequest,
  Response = EventHandlerResponse,
>(
  handler: EventHandler<
    Request extends EventHandlerRequest ? Request : EventHandlerRequest,
    Request extends EventHandlerRequest ? Response : Request
  >,
): EventHandler<
  Request extends EventHandlerRequest ? Request : EventHandlerRequest,
  Request extends EventHandlerRequest ? Response : Request
>;
export function defineEventHandler<
  Request extends EventHandlerRequest,
  Response = EventHandlerResponse,
>(
  handler:
    | EventHandler<Request, Response>
    | EventHandlerObject<Request, Response>,
): EventHandler<Request, Response> {
  // Function Syntax
  if (typeof handler === "function") {
    handler.__is_handler__ = true;
    return handler;
  }
  // Object Syntax
  const _hooks: _EventHandlerHooks = {
    onRequest: _normalizeArray(handler.onRequest),
    onBeforeResponse: _normalizeArray(handler.onBeforeResponse),
  };
  const _handler: EventHandler<Request, any> = (event) => {
    return _callHandler(event, handler.handler, _hooks);
  };
  _handler.__is_handler__ = true;
  _handler.__resolve__ = handler.handler.__resolve__;
  _handler.__websocket__ = handler.websocket;
  return _handler;
}

function _normalizeArray<T>(input?: T | T[]): T[] | undefined {
  return input ? (Array.isArray(input) ? input : [input]) : undefined;
}

async function _callHandler(
  event: H3Event,
  handler: EventHandler,
  hooks: _EventHandlerHooks,
) {
  if (hooks.onRequest) {
    for (const hook of hooks.onRequest) {
      await hook(event);
      if (event.handled) {
        return;
      }
    }
  }
  const body = await handler(event);
  const response = { body };
  if (hooks.onBeforeResponse) {
    for (const hook of hooks.onBeforeResponse) {
      await hook(event, response);
    }
  }
  return response.body;
}

export const eventHandler = defineEventHandler;

export function defineRequestMiddleware<
  Request extends EventHandlerRequest = EventHandlerRequest,
>(fn: _RequestMiddleware<Request>): _RequestMiddleware<Request> {
  return fn;
}

export function defineResponseMiddleware<
  Request extends EventHandlerRequest = EventHandlerRequest,
>(fn: _ResponseMiddleware<Request>): _ResponseMiddleware<Request> {
  return fn;
}

/**
 * Checks if any kind of input is an event handler.
 * @param input The input to check.
 * @returns True if the input is an event handler, false otherwise.
 */
export function isEventHandler(input: any): input is EventHandler {
  return hasProp(input, "__is_handler__");
}

export function toEventHandler(
  input: any,
  _?: any,
  _route?: string,
): EventHandler {
  return input;
}

export interface DynamicEventHandler extends EventHandler {
  set: (handler: EventHandler) => void;
}

export function dynamicEventHandler(
  initial?: EventHandler,
): DynamicEventHandler {
  let current: EventHandler | undefined = initial;
  const wrapper = eventHandler((event) => {
    if (current) {
      return current(event);
    }
  }) as DynamicEventHandler;
  wrapper.set = (handler) => {
    current = handler;
  };
  return wrapper;
}

export function defineLazyEventHandler<T extends LazyEventHandler>(
  factory: T,
): Awaited<ReturnType<T>> {
  let _promise: Promise<typeof _resolved>;
  let _resolved: { handler: EventHandler };

  const resolveHandler = () => {
    if (_resolved) {
      return Promise.resolve(_resolved);
    }
    if (!_promise) {
      _promise = Promise.resolve(factory()).then((r: any) => {
        const handler = r.default || r;
        if (typeof handler !== "function") {
          throw new (TypeError as any)(
            "Invalid lazy handler result. It should be a function:",
            handler,
          );
        }
        _resolved = { handler: toEventHandler(r.default || r) };
        return _resolved;
      });
    }
    return _promise;
  };

  const handler = eventHandler((event) => {
    if (_resolved) {
      return _resolved.handler(event);
    }
    return resolveHandler().then((r) => r.handler(event));
  }) as Awaited<ReturnType<T>>;

  handler.__resolve__ = resolveHandler;

  return handler;
}
export const lazyEventHandler = defineLazyEventHandler;
