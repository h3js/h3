import { iterable, noContent, redirect } from "./utils/response.ts";
import {
  defineNodeHandler,
  fromNodeHandler,
  toNodeHandler,
} from "./adapters.ts";
import { defineEventHandler, defineLazyEventHandler } from "./handler.ts";
import { proxy } from "./utils/proxy.ts";
import { H3 } from "./h3.ts";
import { withBase } from "./utils/base.ts";
import { sanitizeStatusCode, sanitizeStatusMessage } from "./utils/sanitize.ts";

import type { H3Event } from "./types/event.ts";
import type { EventHandler } from "./types/handler.ts";
import type { H3Config } from "./types/h3.ts";

// --- Request ---

/** @deprecated Please use `event.url` */
export const getRequestPath = (event: H3Event) => event.path;

/** @deprecated Please use `event.req.headers.get(name)` */
export function getRequestHeader(
  event: H3Event,
  name: string,
): string | undefined {
  return event.req.headers.get(name) || undefined;
}

/** @deprecated Please use `event.req.headers.get(name)` */
export const getHeader = getRequestHeader;

/** @deprecated Please use `Object.fromEntries(event.req.headers.entries())` */
export function getRequestHeaders(event: H3Event): Record<string, string> {
  return Object.fromEntries(event.req.headers.entries());
}

/** @deprecated Please use `Object.fromEntries(event.req.headers.entries())` */
export const getHeaders = getRequestHeaders;

/** @deprecated Please use `event.req.method` */
export function getMethod(event: H3Event, defaultMethod = "GET") {
  return (event.req.method || defaultMethod).toUpperCase();
}

// --- Request Body ---

/** @deprecated Please use `event.req.text()` or `event.req.arrayBuffer()` */
export function readRawBody<E extends "utf8" | false = "utf8">(
  event: H3Event,
  encoding = "utf8" as E,
): E extends false
  ? Promise<Uint8Array | undefined>
  : Promise<string | undefined> {
  return encoding
    ? (event.req.text() as any)
    : (event.req.arrayBuffer().then((r) => new Uint8Array(r)) as any);
}

/** @deprecated Please use `event.req.formData()` */
export async function readFormDataBody(event: H3Event): Promise<FormData> {
  return event.req.formData();
}

/** @deprecated Please use `event.req.formData()` */
export const readFormData = readFormDataBody;

/** @deprecated Please use `event.req.body` */
export function getBodyStream(
  event: H3Event,
): ReadableStream<Uint8Array> | undefined {
  return event.req.body || undefined;
}

/** @deprecated Please use `event.req.body` */
export const getRequestWebStream = getBodyStream;

// --- Response ---

/** @deprecated Please directly return stream */
export function sendStream(
  _event: H3Event,
  value: ReadableStream,
): ReadableStream {
  return value;
}

/** @deprecated Please use `return noContent(event)` */
export const sendNoContent = noContent;

/** @deprecated Please use `return redirect(event, code)` */
export const sendRedirect = redirect;

/** @deprecated Please directly return response */
export const sendWebResponse = (response: Response) => response;

/** @deprecated Please use `return proxy(event)` */
export const sendProxy = proxy;

/** @deprecated Please use `return iterable(event, value)` */
export const sendIterable = iterable;

/** @deprecated Please use `event.res.statusText` */
export function getResponseStatusText(event: H3Event): string {
  return event.res.statusText || "";
}

/** @deprecated Please use `event.res.headers.append(name, value)` */
export function appendResponseHeader(
  event: H3Event,
  name: string,
  value: string | string[],
): void {
  if (Array.isArray(value)) {
    for (const valueItem of value) {
      event.res.headers.append(name, valueItem!);
    }
  } else {
    event.res.headers.append(name, value!);
  }
}

/** @deprecated Please use `event.res.headers.append(name, value)` */
export const appendHeader = appendResponseHeader;

/** @deprecated Please use `event.res.headers.set(name, value)` */
export function setResponseHeader(
  event: H3Event,
  name: string,
  value: string | string[],
): void {
  if (Array.isArray(value)) {
    event.res.headers.delete(name);
    for (const valueItem of value) {
      event.res.headers.append(name, valueItem!);
    }
  } else {
    event.res.headers.set(name, value!);
  }
}

/** @deprecated Please use `event.res.headers.set(name, value)` */
export const setHeader = setResponseHeader;

/** @deprecated Please use `event.res.headers.set(name, value)` */
export function setResponseHeaders(
  event: H3Event,
  headers: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value!);
  }
}

/** @deprecated Please use `event.res.headers.set(name, value)` */
export const setHeaders = setResponseHeaders;

/** @deprecated Please use `event.res.status` */
export function getResponseStatus(event: H3Event): number {
  return event.res.status || 200;
}

/** @deprecated Please directly set `event.res.status` and `event.res.statusText` */
export function setResponseStatus(
  event: H3Event,
  code?: number,
  text?: string,
): void {
  if (code) {
    event.res.status = sanitizeStatusCode(code, event.res.status);
  }
  if (text) {
    event.res.statusText = sanitizeStatusMessage(text);
  }
}

/** @deprecated Please use `event.res.headers.set("content-type", type)` */
export function defaultContentType(event: H3Event, type?: string) {
  if (
    type &&
    event.res.status !== 304 /* unjs/h3#603 */ &&
    !event.res.headers.has("content-type")
  ) {
    event.res.headers.set("content-type", type);
  }
}

/** @deprecated Please use `Object.fromEntries(event.res.headers.entries())` */
export function getResponseHeaders(event: H3Event): Record<string, string> {
  return Object.fromEntries(event.res.headers.entries());
}

/** @deprecated Please use `event.res.headers.get(name)` */
export function getResponseHeader(
  event: H3Event,
  name: string,
): string | undefined {
  return event.res.headers.get(name) || undefined;
}

/** @deprecated Please use `event.res.headers.delete(name)` instead. */
export function removeResponseHeader(event: H3Event, name: string): void {
  return event.res.headers.delete(name);
}

/** @deprecated Please use `event.res.headers.append(name, value)` */
export function appendResponseHeaders(event: H3Event, headers: string): void {
  for (const [name, value] of Object.entries(headers)) {
    appendResponseHeader(event, name, value!);
  }
}

/** @deprecated Please use `event.res.headers.append(name, value)` */
export const appendHeaders = appendResponseHeaders;

/** @deprecated Please use `event.res.headers.delete` */
export function clearResponseHeaders(
  event: H3Event,
  headerNames?: string[],
): void {
  if (headerNames && headerNames.length > 0) {
    for (const name of headerNames) {
      event.res.headers.delete(name);
    }
  } else {
    for (const name of event.res.headers.keys()) {
      event.res.headers.delete(name);
    }
  }
}

// -- Event handler --

/** Please use `defineEventHandler`  */
export const eventHandler = defineEventHandler;

/** Please use `defineLazyEventHandler` */
export const lazyEventHandler = defineLazyEventHandler;

/** @deprecated Please use `defineNodeHandler` */
export const defineNodeListener = defineNodeHandler;

/** @deprecated Please use `defineNodeHandler` */
export const fromNodeMiddleware = fromNodeHandler;

/** @deprecated Please use `toNodeHandler` */
export const toNodeListener = toNodeHandler;

/** @deprecated */
export function toEventHandler(
  input: any,
  _?: any,
  _route?: string,
): EventHandler {
  return input;
}

// -- App/Router --

/** @deprecated Please use `new H3()` */
export const createApp = (config?: H3Config) => new H3(config);

/** @deprecated Please use `new H3()` */
export const createRouter = (config?: H3Config) => new H3(config);

/** @deprecated Please use `withBase()` */
export const useBase = withBase;
