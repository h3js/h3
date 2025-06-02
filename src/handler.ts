import type {
  EventHandler,
  EventHandlerRequest,
  EventHandlerResponse,
  DynamicEventHandler,
  Middleware,
} from "./types/handler.ts";

// --- event handler ---

export function defineEventHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response = EventHandlerResponse,
>(
  handler: EventHandler<Request, Response>,
  middleware?: Middleware[],
): EventHandler<Request, Response> {
  return middleware?.length ? Object.assign(handler, { middleware }) : handler;
}

//  --- dynamic event handler ---

export function dynamicEventHandler(
  initial?: EventHandler,
): DynamicEventHandler {
  let current: EventHandler | undefined = initial;
  const wrapper = defineEventHandler((event) => {
    if (current) {
      return current(event);
    }
  }) as DynamicEventHandler;
  wrapper.set = (handler) => {
    current = handler;
  };
  return wrapper;
}

// --- lazy event handler ---

export function defineLazyEventHandler(
  load: () => Promise<EventHandler> | EventHandler,
): EventHandler {
  let _promise: Promise<typeof _resolved>;
  let _resolved: { handler: EventHandler };

  const resolveHandler = () => {
    if (_resolved) {
      return Promise.resolve(_resolved);
    }
    if (!_promise) {
      _promise = Promise.resolve(load()).then((r: any) => {
        const handler = r.default || r;
        if (typeof handler !== "function") {
          throw new (TypeError as any)(
            "Invalid lazy handler result. It should be a function:",
            handler,
          );
        }
        _resolved = { handler: r.default || r };
        return _resolved;
      });
    }
    return _promise;
  };

  const handler: EventHandler = (event) => {
    if (_resolved) {
      return _resolved.handler(event);
    }
    return resolveHandler().then((r) => r.handler(event));
  };

  return handler;
}
