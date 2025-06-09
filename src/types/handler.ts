import type { ServerRequest } from "srvx/types";
import type { MaybePromise } from "./_utils.ts";
import type { H3Event } from "./event.ts";
import type { TypedRequest, TypedResponse, ResponseHeaderMap } from "fetchdts";

//  --- event handler ---

export type EventHandler<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
  _ResponseT extends EventHandlerResponse = EventHandlerResponse,
> = (event: H3Event<_RequestT>) => _ResponseT;

export type EventHandlerFetch<T extends Response | TypedResponse = Response> = (
  req: ServerRequest | URL | string,
  init?: RequestInit,
) => Promise<T>;

export interface EventHandlerObject<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
  _ResponseT extends EventHandlerResponse = EventHandlerResponse,
> {
  handler: EventHandler<_RequestT, _ResponseT>;
  middleware?: Middleware[];
}

export interface EventHandlerRequest {
  body?: unknown;
  query?: Partial<Record<string, string>>;
  routerParams?: Record<string, string>;
}

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

export type EventHandlerWithFetch<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
  _ResponseT extends EventHandlerResponse = EventHandlerResponse,
> = EventHandler<_RequestT, _ResponseT> & {
  fetch: EventHandlerFetch<TypedResponse<_ResponseT, ResponseHeaderMap>>;
};

export type TypedServerRequest<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> = Omit<ServerRequest, "json" | "headers" | "clone"> &
  Pick<
    TypedRequest<NonNullable<_RequestT["body"]>, Record<string, string>>,
    "json" | "headers" | "clone"
  >;

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
