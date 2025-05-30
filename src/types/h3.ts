import type * as crossws from "crossws";
import type { H3Event } from "./event.ts";
import type { EventHandler } from "./handler.ts";
import type { H3Error } from "../error.ts";

// https://www.rfc-editor.org/rfc/rfc7231#section-4.1
// prettier-ignore
export type HTTPMethod =  "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "DELETE" | "CONNECT" | "OPTIONS" | "TRACE";

type MaybePromise<T = unknown> = T | Promise<T>;

export interface H3Config {
  debug?: boolean;

  onError?: (error: H3Error, event: H3Event) => MaybePromise<void | unknown>;
  onRequest?: (event: H3Event) => MaybePromise<void>;
  onBeforeResponse?: (
    event: H3Event,
    response: Response | PreparedResponse,
  ) => MaybePromise<void>;
}

export type PreparedResponse = ResponseInit & { body?: BodyInit | null };

export interface H3Route {
  route?: string;
  method?: HTTPMethod;
  handler: EventHandler;
}
