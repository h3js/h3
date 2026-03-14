import { IncomingMessage } from "node:http";
import {
  IncomingMessage as NodeIncomingMessage,
  ServerResponse as NodeServerResponse,
} from "node-mock-http";
import type { App } from "../app";
import type { HTTPMethod } from "../types";
import { createError, isError, sendError } from "../error";
import { H3Event, createEvent, eventHandler } from "../event";
import {
  getRequestWebStream,
  setResponseHeader,
  setResponseStatus,
  splitCookiesString,
} from "../utils";

export interface PlainRequest {
  _eventOverrides?: Partial<H3Event>;
  context?: Record<string, unknown>;

  method: string;
  path: string;
  headers: HeadersInit;
  body?: null | BodyInit;
}

export interface PlainResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body?: unknown;
}

export type PlainHandler = (request: PlainRequest) => Promise<PlainResponse>;

/** @experimental */
export function toPlainHandler(app: App) {
  const handler: PlainHandler = (request) => {
    return _handlePlainRequest(app, request);
  };
  return handler;
}

/** @experimental */
export function fromPlainHandler(handler: PlainHandler) {
  return eventHandler(async (event) => {
    const res = await handler({
      method: event.method,
      path: event.path,
      headers: Object.fromEntries(event.headers.entries()),
      body: getRequestWebStream(event),
      context: event.context,
    });
    setResponseStatus(event, res.status, res.statusText);
    for (const [key, value] of res.headers) {
      setResponseHeader(event, key, value);
    }
    return res.body;
  });
}

// --- Internal ---

export async function _handlePlainRequest(app: App, request: PlainRequest) {
  // Normalize request
  const path = request.path;
  const method = (request.method || "GET").toUpperCase() as HTTPMethod;
  const headers = new Headers(request.headers);

  // Shim for Node.js request and response objects
  // TODO: Remove in next major version
  const nodeReq =
    new NodeIncomingMessage() as unknown /* unenv */ as IncomingMessage;
  const nodeRes = new NodeServerResponse(nodeReq);

  // Fill node request properties
  nodeReq.method = method;
  nodeReq.url = path;
  // TODO: Normalize with array merge and lazy getter
  nodeReq.headers = Object.fromEntries(headers.entries());

  // Create new event
  const event = createEvent(nodeReq, nodeRes as any);

  // Fill internal event properties
  event._method = method;
  event._path = path;
  event._headers = headers;
  if (request.body) {
    event._requestBody = request.body;
  }
  if (request._eventOverrides) {
    Object.assign(event, request._eventOverrides);
  }
  if (request.context) {
    Object.assign(event.context, request.context);
  }

  // Run app handler logic
  try {
    await app.handler(event);
  } catch (_error: any) {
    const error = createError(_error);
    if (!isError(_error)) {
      error.unhandled = true;
    }
    if (app.options.onError) {
      await app.options.onError(error, event);
    }
    if (!event.handled) {
      if (error.unhandled || error.fatal) {
        console.error("[h3]", error.fatal ? "[fatal]" : "[unhandled]", error);
      }
      await sendError(event, error, !!app.options.debug);
    }
  }

  return {
    status: nodeRes.statusCode,
    statusText: nodeRes.statusMessage,
    headers: _normalizeUnenvHeaders(nodeRes._headers),
    body: (nodeRes as any)._data,
  };
}

function _normalizeUnenvHeaders(
  input: Record<string, undefined | string | number | string[]>,
) {
  const headers: [string, string][] = [];
  const cookies: string[] = [];

  for (const _key in input) {
    const key = _key.toLowerCase();

    if (key === "set-cookie") {
      cookies.push(
        ...splitCookiesString(input["set-cookie"] as string | string[]),
      );
      continue;
    }

    const value = input[key];
    if (Array.isArray(value)) {
      for (const _value of value) {
        headers.push([key, _value]);
      }
    } else if (value !== undefined) {
      headers.push([key, String(value)]);
    }
  }

  if (cookies.length > 0) {
    for (const cookie of cookies) {
      headers.push(["set-cookie", cookie]);
    }
  }

  return headers;
}
