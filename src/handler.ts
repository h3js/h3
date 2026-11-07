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
  ResolvedRequest,
} from "./types/handler.ts";
import type { StandardSchemaV1, InferOutput } from "./utils/internal/standard-schema.ts";
import { NoHandler, type H3Core } from "./h3.ts";
import { validatedRequest, validatedURL, type OnValidateError } from "./utils/internal/validate.ts";

// --- event handler ---

export function defineHandler<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse = EventHandlerResponse,
>(handler: EventHandler<TRequest, TResponse>): EventHandlerWithFetch<TRequest, TResponse>;

export function defineHandler<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse = EventHandlerResponse,
>(def: EventHandlerObject<TRequest, TResponse>): EventHandlerWithFetch<TRequest, TResponse>;

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

  const composed = input.middleware?.length && composeHandler(input.middleware, handler);
  const eventHandler = handlerWithFetch(composed || handler);

  // When middleware is composed, `.fetch` must stay the composed one: assigning `input` would
  // restore the raw `input.fetch` and requests made through it would bypass the middleware
  return Object.assign(eventHandler, input, composed && { fetch: eventHandler.fetch });
}

type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

type QueryValues<T> = {
  [K in keyof T]: Extract<T[K], string | string[]>;
};

export type ValidatedRequest<
  TRequestBody extends StandardSchemaV1,
  TRequestHeaders extends StandardSchemaV1,
  TRequestQuery extends StandardSchemaV1,
> = {
  body: InferOutput<TRequestBody>;
  headers: StringHeaders<InferOutput<TRequestHeaders>>;
  query: QueryValues<InferOutput<TRequestQuery>>;
};

/**
 * @experimental defineValidatedHandler is an experimental feature and API may change.
 */
export function defineValidatedHandler<
  TRequestBody extends StandardSchemaV1,
  TRequestHeaders extends StandardSchemaV1,
  TRequestQuery extends StandardSchemaV1,
  TResponse extends EventHandlerResponse = EventHandlerResponse,
>(
  def: Omit<EventHandlerObject, "handler"> & {
    validate?: {
      body?: TRequestBody;
      headers?: TRequestHeaders;
      query?: TRequestQuery;
      onError?: OnValidateError;
    };
    handler: EventHandler<
      ValidatedRequest<TRequestBody, TRequestHeaders, TRequestQuery>,
      TResponse
    >;
  },
): EventHandlerWithFetch<
  ValidatedRequest<TRequestBody, TRequestHeaders, TRequestQuery>,
  TResponse
> {
  if (!def.validate) {
    return defineHandler(def) as any;
  }
  return defineHandler({
    ...def,
    handler: async function _validatedHandler(event) {
      (event as any) /* readonly */.req = await validatedRequest(event.req, def.validate!);
      (event as any) /* readonly */.url = await validatedURL(event.url, def.validate!);
      return def.handler(event as any);
    },
  }) as any;
}

// --- handler .fetch ---

function handlerWithFetch<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse = EventHandlerResponse,
>(handler: EventHandler<TRequest, TResponse>): EventHandlerWithFetch<TRequest, TResponse> {
  if ("fetch" in handler) {
    return handler as EventHandlerWithFetch<TRequest, TResponse>;
  }
  return Object.assign(handler, {
    fetch: (req: ServerRequest | URL | string): Promise<Response> => {
      if (typeof req === "string") {
        req = new URL(req, "http://_");
      }
      if (req instanceof URL) {
        req = new Request(req);
      }
      const event = new H3Event(req) as H3Event<TRequest>;
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

export function defineLazyEventHandler<TRequest extends EventHandlerRequest = EventHandlerRequest>(
  loader: () => MaybePromise<HTTPHandler<TRequest>>,
): EventHandlerWithFetch<ResolvedRequest<TRequest>> {
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

export function toEventHandler<TRequest extends EventHandlerRequest = EventHandlerRequest>(
  handler: HTTPHandler<TRequest> | undefined,
): EventHandler<ResolvedRequest<TRequest>> | undefined {
  if (typeof handler === "function") {
    return handler as EventHandler<ResolvedRequest<TRequest>>;
  }
  if (typeof (handler as H3Core)?.handler === "function" && (handler as any).constructor?.["~h3"]) {
    return (handler as H3Core).handler as EventHandler<ResolvedRequest<TRequest>>;
  }
  if (typeof (handler as FetchableObject)?.fetch === "function") {
    return function _fetchHandler(event: H3Event) {
      return (handler as FetchableObject).fetch!(event.req);
    };
  }
}
