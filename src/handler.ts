import type { ServerRequest } from "srvx";
import { H3Event } from "./event.ts";
import { callMiddleware } from "./middleware.ts";
import { toResponse } from "./response.ts";

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
import type {
  InferOutput,
  StandardSchemaV1,
} from "./utils/internal/standard-schema.ts";
import { NoHandler, type H3Core } from "./h3.ts";
import {
  validatedRequest,
  validatedURL,
  syncValidate,
  validateResponse,
} from "./utils/internal/validate.ts";

// --- event handler ---

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(handler: EventHandler<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res = EventHandlerResponse,
>(def: EventHandlerObject<Req, Res>): EventHandlerWithFetch<Req, Res>;

export function defineHandler(
  input: EventHandler | EventHandlerObject,
): EventHandlerWithFetch {
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
      input.middleware?.length
        ? function _handlerMiddleware(event) {
            return callMiddleware(event, input.middleware!, handler);
          }
        : handler,
    ),
    input,
  );
}

type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * @experimental defineValidatedHandler is an experimental feature and API may change.
 */
// Helper type to create a validated H3Event with typed context.params
// After validation, params will have the inferred type from the schema
// Note: params remains optional for TypeScript compatibility, but is guaranteed at runtime
type ValidatedH3Event<RequestT extends EventHandlerRequest, Params> = Omit<
  H3Event<RequestT>,
  "context"
> & {
  context: Omit<H3Event["context"], "params"> & {
    params?: Params; // Typed from schema (optional for TS, guaranteed after validation)
  };
};

export function defineValidatedHandler<
  RequestBody extends StandardSchemaV1 = StandardSchemaV1<any>,
  RequestHeaders extends StandardSchemaV1 = StandardSchemaV1<any>,
  RequestQuery extends StandardSchemaV1 = StandardSchemaV1<any>,
  RouteParams extends StandardSchemaV1 = StandardSchemaV1<
    Record<string, string>
  >,
  ResponseBody extends StandardSchemaV1 = StandardSchemaV1<any>,
>(
  def: Omit<EventHandlerObject, "handler"> & {
    validate?: {
      body?: RequestBody;
      headers?: RequestHeaders;
      query?: RequestQuery;
      params?: RouteParams;
      response?: ResponseBody;
    };
    handler: (
      event: ValidatedH3Event<
        EventHandlerRequest & {
          body: InferOutput<RequestBody>;
          query: StringHeaders<InferOutput<RequestQuery>>;
          routerParams: InferOutput<RouteParams>;
        },
        InferOutput<RouteParams>
      >,
    ) => InferOutput<ResponseBody> | Promise<InferOutput<ResponseBody>>;
  },
): EventHandlerWithFetch<EventHandlerRequest, InferOutput<ResponseBody>> {
  if (!def.validate) {
    return defineHandler(def) as EventHandlerWithFetch<
      EventHandlerRequest,
      InferOutput<ResponseBody>
    >;
  }
  return defineHandler({
    ...def,
    handler: async function _validatedHandler(event) {
      // Validate route params
      if (def.validate!.params) {
        const params = event.context.params || {};
        event.context.params = syncValidate(
          "params",
          params,
          def.validate!.params,
        ) as Record<string, string>;
      }

      // Validate request and URL
      (event as any) /* readonly */.req = validatedRequest(
        event.req,
        def.validate!,
      );
      (event as any) /* readonly */.url = validatedURL(
        event.url,
        def.validate!,
      );

      // Execute handler - context.params is validated at this point
      const result = await def.handler(
        event as ValidatedH3Event<
          EventHandlerRequest & {
            body: InferOutput<RequestBody>;
            query: StringHeaders<InferOutput<RequestQuery>>;
            routerParams: InferOutput<RouteParams>;
          },
          InferOutput<RouteParams>
        >,
      );

      // Validate response
      if (def.validate!.response) {
        return await validateResponse(result, def.validate!.response);
      }

      return result;
    },
  }) as EventHandlerWithFetch<EventHandlerRequest, InferOutput<ResponseBody>>;
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
        return Promise.resolve(toResponse(error, event));
      }
    },
  });
}

//  --- dynamic event handler ---

export function dynamicEventHandler(
  initial?: EventHandler | FetchableObject,
): DynamicEventHandler {
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
  const resolveLazyHandler = () => {
    if (handler) {
      return Promise.resolve(handler);
    }
    return (promise ??= Promise.resolve(loader()).then((r: any) => {
      handler = toEventHandler(r) || toEventHandler(r.default);
      if (typeof handler !== "function") {
        // @ts-expect-error
        throw new TypeError("Invalid lazy handler", { cause: { resolved: r } });
      }
      return handler;
    }));
  };
  return defineHandler(function lazyHandler(event) {
    return handler
      ? handler(event)
      : resolveLazyHandler().then((r) => r(event));
  });
}

// --- normalization utils ---

export function toEventHandler(
  handler: HTTPHandler | undefined,
): EventHandler | undefined {
  if (typeof handler === "function") {
    return handler;
  }
  if (typeof (handler as H3Core)?.handler === "function") {
    return (handler as H3Core).handler;
  }
  if (typeof (handler as FetchableObject)?.fetch === "function") {
    return function _fetchHandler(event: H3Event) {
      return (handler as FetchableObject).fetch!(event.req);
    };
  }
}
