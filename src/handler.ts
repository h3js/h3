import type { ServerRequest } from "srvx";
import { H3Event } from "./event.ts";
import { toRequest } from "./h3.ts";
import { callMiddleware } from "./middleware.ts";
import { toResponse } from "./response.ts";

import type {
  EventHandler,
  EventHandlerObject,
  EventHandlerRequest,
  EventHandlerResponse,
  DynamicEventHandler,
  EventHandlerWithFetch,
} from "./types/handler.ts";
import type {
  InferOutput,
  StandardSchemaV1,
} from "./utils/internal/standard-schema.ts";
import type { TypedRequest } from "fetchdts";
import { validatedRequest, validatedURL } from "./utils/internal/validate.ts";

// --- event handler ---

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(handler: EventHandler<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(def: EventHandlerObject<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler(arg1: unknown): EventHandlerWithFetch {
  if (typeof arg1 === "function") {
    return handlerWithFetch(arg1 as EventHandler);
  }
  const { middleware, handler, meta } = arg1 as EventHandlerObject;
  const _handler = handlerWithFetch(
    middleware?.length
      ? (event) => callMiddleware(event, middleware, handler)
      : handler,
  );
  _handler.meta = meta;
  return _handler;
}

type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * @experimental defineValidatedHandler is an experimental feature and API may change.
 */
export function defineValidatedHandler<
  RequestBody extends StandardSchemaV1,
  RequestHeaders extends StandardSchemaV1,
  RequestQuery extends StandardSchemaV1,
  Res extends EventHandlerResponse = EventHandlerResponse,
>(
  def: Omit<EventHandlerObject, "handler"> & {
    validate?: {
      body?: RequestBody;
      headers?: RequestHeaders;
      query?: RequestQuery;
    };
    handler: EventHandler<
      {
        body: InferOutput<RequestBody>;
        query: StringHeaders<InferOutput<RequestQuery>>;
      },
      Res
    >;
  },
): EventHandlerWithFetch<
  TypedRequest<InferOutput<RequestBody>, InferOutput<RequestHeaders>>,
  Res
> {
  if (!def.validate) {
    return defineHandler(def) as any;
  }
  return defineHandler({
    ...def,
    handler: (event) => {
      (event as any) /* readonly */.req = validatedRequest(
        event.req,
        def.validate!,
      );
      (event as any) /* readonly */.url = validatedURL(
        event.url,
        def.validate!,
      );
      return def.handler(event as any);
    },
  }) as any;
}

// --- handler .fetch ---

function handlerWithFetch<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(handler: EventHandler<Req, Res>): EventHandlerWithFetch<Req, Res> {
  return Object.assign(handler, {
    fetch: (
      _req: ServerRequest | URL | string,
      _init?: RequestInit,
    ): Promise<Response> => {
      const req = toRequest(_req, _init);
      const event = new H3Event(req) as H3Event<Req>;
      try {
        return Promise.resolve(toResponse(handler(event), event));
      } catch (error: any) {
        return Promise.resolve(toResponse(error, event));
      }
    },
  });
}

//  --- dynamic event handler ---

export function dynamicEventHandler(
  initial?: EventHandler,
): DynamicEventHandler {
  let current: EventHandler | undefined = initial;
  return Object.assign(
    defineHandler((event: H3Event) => current?.(event)),
    {
      set: (handler: EventHandler) => {
        current = handler;
      },
    },
  );
}

// --- lazy event handler ---

export function defineLazyEventHandler(
  load: () => Promise<EventHandler> | EventHandler,
): EventHandlerWithFetch {
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

  return defineHandler((event) => {
    if (_resolved) {
      return _resolved.handler(event);
    }
    return resolveHandler().then((r) => r.handler(event));
  });
}
