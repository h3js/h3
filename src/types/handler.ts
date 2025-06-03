import type { MaybePromise } from "./_utils.ts";
import type { H3Event } from "./event.ts";

//  --- event handler ---

export type EventHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> = (event: H3Event<Request>) => Response;

export interface EventHandlerObject<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> {
  handler: EventHandler<Request, Response>;
  middleware?: Middleware[];
}

export interface EventHandlerRequest {
  body?: unknown;
  query?: Record<string, string>;
  routerParams?: Record<string, string>;
}

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

//  --- middleware ---

export type Middleware = (
  event: H3Event,
  next: () => MaybePromise<unknown | undefined>,
) => MaybePromise<unknown | undefined>;

// --- lazy event handler ---

export type LazyEventHandler = () => EventHandler | Promise<EventHandler>;

export interface DynamicEventHandler extends EventHandler {
  set: (handler: EventHandler) => void;
}

// --- utils ---

export type InferEventInput<
  Key extends keyof EventHandlerRequest,
  Event extends H3Event,
  T,
> = void extends T ? (Event extends H3Event<infer E> ? E[Key] : never) : T;
