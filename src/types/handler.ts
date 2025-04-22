import type { H3Event } from "./event.ts";
import type { Hooks as WSHooks } from "crossws";
import type { HTTPMethod, WebSocketOptions } from "./h3.ts";
import type { H3 } from "../h3.ts";

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

export interface EventHandlerRequest {
  body?: unknown;
  query?: Record<string, string>;
  routerParams?: Record<string, string>;
}

export type InferEventInput<
  Key extends keyof EventHandlerRequest,
  Event extends H3Event,
  T,
> = void extends T ? (Event extends H3Event<infer E> ? E[Key] : never) : T;

type MaybePromise<T> = T | Promise<T>;

export type ResolvedEventHandler = {
  method?: HTTPMethod;
  route?: string;
  handler?: EventHandler;
  params?: Record<string, string>;
};

export type EventHandlerResolver = (
  method: HTTPMethod,
  path: string,
) => MaybePromise<undefined | ResolvedEventHandler>;

export interface EventHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> extends Partial<Pick<H3, "handler" | "resolve" | "config">> {
  (event: H3Event<Request>): Response;
  websocket?: WebSocketOptions;
}

export type RequestMiddleware<
  Request extends EventHandlerRequest = EventHandlerRequest,
> = (event: H3Event<Request>) => void | Promise<void>;

export type ResponseMiddleware<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> = (
  event: H3Event<Request>,
  response: { body?: Awaited<Response> },
) => void | Promise<void>;

export type EventHandlerObject<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> = {
  onRequest?: RequestMiddleware<Request> | RequestMiddleware<Request>[];
  onBeforeResponse?:
    | ResponseMiddleware<Request, Response>
    | ResponseMiddleware<Request, Response>[];
  /** @experimental */
  websocket?: Partial<WSHooks>;
  handler: EventHandler<Request, Response>;
};

export type LazyEventHandler = () => EventHandler | Promise<EventHandler>;

export interface DynamicEventHandler extends EventHandler {
  set: (handler: EventHandler) => void;
}
