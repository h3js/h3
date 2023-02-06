import type { H3Event } from "./event";
import { Session } from "./utils/session";

// https://www.rfc-editor.org/rfc/rfc7231#section-4.1
export type HTTPMethod =
  | "GET"
  | "HEAD"
  | "PATCH"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE";

export type Encoding =
  | false
  | "ascii"
  | "utf8"
  | "utf-8" // eslint-disable-line unicorn/text-encoding-identifier-case
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "base64"
  | "latin1"
  | "binary"
  | "hex";

export interface H3EventContext extends Record<string, any> {
  /* Matched router parameters */
  params?: Record<string, string>;
  /* Cached session data */
  sessions?: Record<string, Session>;
}

export type EventHandlerResponse<T = any> = T | Promise<T>;

export interface EventHandler<T = any> {
  __is_handler__?: true;
  (event: H3Event): EventHandlerResponse<T>;
}

export type LazyEventHandler = () => EventHandler | Promise<EventHandler>;

export type RequestHeaders = { [name: string]: string | undefined };
