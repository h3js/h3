import type { ServerRequest } from "srvx/types";
import type { MaybePromise } from "./_utils.ts";
import type { H3Event } from "./event.ts";
import type { ResponseHeaderMap, TypedResponse } from "fetchdts";

//  --- event handler ---

export type EventHandler<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res extends EventHandlerResponse = EventHandlerResponse,
> = (event: H3Event<Req>) => Res;

export type EventHandlerFetch<T extends Response | TypedResponse = Response> = (
  req: ServerRequest | URL | string,
  init?: RequestInit,
) => Promise<T>;

export interface EventHandlerObject<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res extends EventHandlerResponse = EventHandlerResponse,
> {
  handler: EventHandler<Req, Res>;
  middleware?: Middleware[];
}

export interface EventHandlerRequest {
  body?: unknown;
  query?: Record<string, string>;
  routerParams?: Record<string, string>;
}

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

export type EventHandlerWithFetch<
  Req extends EventHandlerRequest = EventHandlerRequest,
  Res extends EventHandlerResponse = EventHandlerResponse,
> = EventHandler<Req, Res> & {
  fetch: EventHandlerFetch<TypedResponse<Res, ResponseHeaderMap>>;
};

//  --- middleware ---

export type Middleware = (
  event: H3Event,
  next: () => MaybePromise<unknown | undefined>,
) => MaybePromise<unknown | undefined>;

// --- lazy event handler ---

export type LazyEventHandler = () => EventHandler | Promise<EventHandler>;

export interface DynamicEventHandler extends EventHandlerWithFetch {
  set: (handler: EventHandler) => void;
}

// --- utils ---

export type InferEventInput<
  Key extends keyof EventHandlerRequest,
  Event extends H3Event,
  T,
> = void extends T ? (Event extends H3Event<infer E> ? E[Key] : never) : T;
