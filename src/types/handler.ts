import type { ServerRequest } from "srvx";
import type { RequestHeaderMap, ResponseHeaderMap, TypedRequest, TypedResponse } from "fetchdts";
import type { H3Event, HTTPEvent } from "../event.ts";
import type { MaybePromise } from "./_utils.ts";
import type { H3RouteMeta } from "./h3.ts";
import type { H3Core } from "../h3.ts";

export type HTTPHandler<TRequest extends EventHandlerRequest = any> =
  | EventHandler<TRequest>
  | FetchableObject
  | H3Core;

/** Collapses the `any` request type of a bare {@link HTTPHandler} to the default request shape. */
export type ResolvedRequest<TRequest extends EventHandlerRequest> = 0 extends 1 & TRequest
  ? EventHandlerRequest
  : TRequest;

//  --- event handler ---

export interface EventHandler<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse extends EventHandlerResponse = EventHandlerResponse,
> {
  (event: H3Event<TRequest>): TResponse;
  meta?: H3RouteMeta;
}

export interface EventHandlerObject<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse extends EventHandlerResponse = EventHandlerResponse,
> {
  handler?: EventHandler<TRequest, TResponse>;
  fetch?: FetchHandler;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
}

export interface EventHandlerRequest {
  body?: unknown;
  headers?: unknown;
  query?: Partial<Record<string, string | string[]>>;
  routerParams?: Record<string, string>;
}

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

export type TypedServerRequest<TRequest extends EventHandlerRequest = EventHandlerRequest> = Omit<
  ServerRequest,
  "json" | "headers" | "clone"
> &
  Pick<
    TypedRequest<NonNullable<TRequest["body"]>, Record<keyof RequestHeaderMap, string>>,
    "json" | "headers" | "clone"
  >;

// --- fetchable ---

export type FetchHandler = (req: ServerRequest) => Response | Promise<Response>;
export type FetchableObject = { fetch: FetchHandler };

export type EventHandlerWithFetch<
  TRequest extends EventHandlerRequest = EventHandlerRequest,
  TResponse extends EventHandlerResponse = EventHandlerResponse,
> = EventHandler<TRequest, TResponse> & {
  fetch: EventHandlerFetch<TypedResponse<TResponse, ResponseHeaderMap>>;
};

export type EventHandlerFetch<T extends Response | TypedResponse = Response> = (
  req: ServerRequest | URL | string,
) => Promise<T>;

//  --- middleware ---

export type Middleware = (
  event: H3Event,
  next: () => MaybePromise<unknown | undefined>,
) => MaybePromise<unknown | undefined>;

// --- lazy event handler ---

export type LazyEventHandler = () =>
  | EventHandler
  | FetchableObject
  | Promise<EventHandler | FetchableObject>;

export interface DynamicEventHandler extends EventHandlerWithFetch {
  set: (handler: EventHandler | FetchableObject) => void;
}

// --- utils ---

export type InferEventInput<
  TKey extends keyof EventHandlerRequest,
  TEvent extends HTTPEvent,
  T,
> = void extends T ? (TEvent extends HTTPEvent<infer E> ? E[TKey] : never) : T;
