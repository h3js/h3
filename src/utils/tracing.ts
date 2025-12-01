import { channel, tracingChannel } from "node:diagnostics_channel";
import type { H3Event } from "../event.ts";
import type { H3Core } from "../h3.ts";
import type { ServerRequest } from "srvx";

export type HandlerType = "middleware" | "route";

export interface H3InitPayload {
  app: H3Core;
}

export interface H3MountPayload {
  app: H3Core;
  base: string;
  mountedApp: unknown;
}

export interface H3RequestHandlerPayload {
  request: ServerRequest;
  event: H3Event;
  type: HandlerType;
}

const initChannel = channel("h3.init");
const mountChannel = channel("h3.mount");

const requestHandlerChannel = tracingChannel("h3.request.handler");

/**
 * Publish h3.init diagnostic event when H3 app is initialized.
 */
export function publishInit(app: H3Core): void {
  if (initChannel.hasSubscribers) {
    initChannel.publish({ app } satisfies H3InitPayload);
  }
}

/**
 * Publish h3.mount diagnostic event when a nested app is mounted.
 */
export function publishMount(
  app: H3Core,
  base: string,
  mountedApp: unknown,
): void {
  if (mountChannel.hasSubscribers) {
    mountChannel.publish({ app, base, mountedApp } satisfies H3MountPayload);
  }
}

/**
 * Trace a request handler execution with the h3.request.handler tracing channel.
 * This creates spans for middleware and route handlers that can be observed by APM tools.
 */
export function traceRequestHandler<T>(
  event: H3Event,
  type: HandlerType,
  fn: () => Promise<T>,
): T | Promise<T> {
  const payload: H3RequestHandlerPayload = {
    request: event.req,
    event,
    type,
  };

  return requestHandlerChannel.tracePromise(fn, payload);
}
