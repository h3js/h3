import type { H3Event } from "./event.ts";
import type { H3 } from "../h3.ts";

export interface EventHandlerRequest {
  body?: unknown;
  query?: Record<string, string>;
  routerParams?: Record<string, string>;
}

export type EventHandlerResponse<T = unknown> = T | Promise<T>;

export type InferEventInput<
  Key extends keyof EventHandlerRequest,
  Event extends H3Event,
  T,
> = void extends T ? (Event extends H3Event<infer E> ? E[Key] : never) : T;

type MaybePromise<T> = T | Promise<T>;

export interface EventHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response extends EventHandlerResponse = EventHandlerResponse,
> extends Partial<Pick<H3, "handler" | "config">> {
  (event: H3Event<Request>): Response;
}

//  --- middleware ---

export interface Middleware {
  (
    event: H3Event,
    next: () => MaybePromise<unknown | undefined>,
  ): MaybePromise<unknown | undefined>;
  match?: (event: H3Event) => boolean;
}

export interface MiddlewareOptions {
  route?: string;
  method?: string;
  match?: (event: H3Event) => boolean;
}

// --- lazy event handler ---

export type LazyEventHandler = () => EventHandler | Promise<EventHandler>;

export interface DynamicEventHandler extends EventHandler {
  set: (handler: EventHandler) => void;
}
