import type { ServerRequest } from "srvx";
import { H3Event } from "./event.ts";
import { composeHandler } from "./middleware.ts";
import { toError, toResponse } from "./response.ts";

import type {
  EventHandler,
  EventHandlerObject,
  EventHandlerRequest,
  EventHandlerResponse,
  DynamicEventHandler,
  EventHandlerWithFetch,
  FetchableObject,
  HTTPHandler,
} from "./types/handler.ts";
import type { StandardSchemaV1, InferOutput } from "./utils/internal/standard-schema.ts";
import type { TypedRequest } from "fetchdts";
import { NoHandler, type H3Core } from "./h3.ts";
import {
  validatedRequest,
  validatedURL,
  validatedParams,
  type OnValidateError,
} from "./utils/internal/validate.ts";
import { chain } from "./utils/internal/promise.ts";

// --- event handler ---

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(handler: EventHandler<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(def: EventHandlerObject<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler(input: EventHandler | EventHandlerObject): EventHandlerWithFetch {
  if (typeof input === "function") {
    return handlerWithFetch(input as EventHandler);
  }
  const handler: EventHandler =
    input.handler ||
    (input.fetch
      ? function _fetchHandler(event) {
          return input.fetch!(event.req);
        }
      : NoHandler);

  return Object.assign(
    handlerWithFetch(
      input.middleware?.length ? composeHandler(input.middleware, handler) : handler,
    ),
    input,
  );
}

type StringsOnly<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * @experimental defineValidatedHandler is an experimental feature and API may change.
 */
export function defineValidatedHandler<
  RequestBody extends StandardSchemaV1,
  RequestHeaders extends StandardSchemaV1,
  RequestQuery extends StandardSchemaV1,
  RequestParams extends StandardSchemaV1,
  Res extends EventHandlerResponse = EventHandlerResponse,
>(
  def: Omit<EventHandlerObject, "handler"> & {
    validate?: {
      body?: RequestBody;
      headers?: RequestHeaders;
      query?: RequestQuery;
      params?: RequestParams;
      decodeParams?: boolean;
      onError?: OnValidateError;
    };
    handler: EventHandler<
      {
        body: InferOutput<RequestBody>;
        query: StringsOnly<InferOutput<RequestQuery>>;
        routerParams: StringsOnly<InferOutput<RequestParams>>;
      },
      Res
    >;
  },
): EventHandlerWithFetch<TypedRequest<InferOutput<RequestBody>, InferOutput<RequestHeaders>>, Res> {
  if (!def.validate) {
    return defineHandler(def) as any;
  }
  return defineHandler({
    ...def,
    handler: function _validatedHandler(event) {
      const v = def.validate!;
      // `chain` keeps a fully-sync path from yielding a microtask.
      // params → headers → query in sequential order
      return chain(validatedParams(event, v), () =>
        chain(validatedRequest(event.req, v), (req) => {
          (event as any) /* readonly */.req = req;
          return chain(validatedURL(event.url, v), (url) => {
            (event as any) /* readonly */.url = url;
            return def.handler(event as any);
          });
        }),
      );
    },
  }) as any;
}

// --- handler .fetch ---

function handlerWithFetch<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(handler: EventHandler<Req, Res>): EventHandlerWithFetch<Req, Res> {
  if ("fetch" in handler) {
    return handler as EventHandlerWithFetch<Req, Res>;
  }
  return Object.assign(handler, {
    fetch: (req: ServerRequest | URL | string): Promise<Response> => {
      if (typeof req === "string") {
        req = new URL(req, "http://_");
      }
      if (req instanceof URL) {
        req = new Request(req);
      }
      const event = new H3Event(req) as H3Event<Req>;
      try {
        return Promise.resolve(toResponse(handler(event), event));
      } catch (error: any) {
        return Promise.resolve(toResponse(toError(error), event));
      }
    },
  });
}

//  --- dynamic event handler ---

export function dynamicEventHandler(initial?: EventHandler | FetchableObject): DynamicEventHandler {
  let current: EventHandler | undefined = toEventHandler(initial);
  return Object.assign(
    defineHandler(function _dynamicEventHandler(event: H3Event) {
      return current?.(event);
    }),
    {
      set: (handler: EventHandler | FetchableObject) => {
        current = toEventHandler(handler);
      },
    },
  );
}

// --- lazy event handler ---

type MaybePromise<T> = T | Promise<T>;

export function defineLazyEventHandler(
  loader: () => MaybePromise<HTTPHandler>,
): EventHandlerWithFetch {
  let handler: EventHandler | undefined;
  let promise: Promise<EventHandler> | undefined;
  return defineHandler(function lazyHandler(event) {
    return handler
      ? handler(event)
      : (promise ??= Promise.resolve(loader()).then(function resolveLazyHandler(r: any) {
          handler = toEventHandler(r) || toEventHandler(r.default);
          if (typeof handler !== "function") {
            throw new TypeError("Invalid lazy handler", { cause: { resolved: r } });
          }
          return handler;
        })).then((r) => r(event));
  });
}

// --- normalization utils ---

export function toEventHandler(handler: HTTPHandler | undefined): EventHandler | undefined {
  if (typeof handler === "function") {
    return handler;
  }
  if (typeof (handler as H3Core)?.handler === "function" && (handler as any).constructor?.["~h3"]) {
    return (handler as H3Core).handler;
  }
  if (typeof (handler as FetchableObject)?.fetch === "function") {
    return function _fetchHandler(event: H3Event) {
      return (handler as FetchableObject).fetch!(event.req);
    };
  }
}
