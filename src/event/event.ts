import type { IncomingHttpHeaders } from "node:http";
import type { H3EventContext, HTTPMethod, EventHandlerRequest } from "../types";
import type { NodeIncomingMessage, NodeServerResponse } from "../adapters/node";
import { sendWebResponse } from "../utils";
import { hasProp } from "../utils/internal/object";

export interface NodeEventContext {
  req: NodeIncomingMessage & { originalUrl?: string };
  res: NodeServerResponse;
}

export interface WebEventContext {
  request?: Request;
  url?: URL;
}

export class H3Event<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> implements Pick<FetchEvent, "respondWith"> {
  "__is_event__" = true;

  // Context
  node: NodeEventContext; // Node
  web?: WebEventContext; // Web
  context: H3EventContext = {}; // Shared

  // Request
  _method?: HTTPMethod;
  _path?: string;
  _headers?: Headers;
  _requestBody?: BodyInit;

  // Response
  _handled = false;

  // Hooks
  _onBeforeResponseCalled: boolean | undefined;
  _onAfterResponseCalled: boolean | undefined;

  constructor(req: NodeIncomingMessage, res: NodeServerResponse) {
    this.node = { req, res };
  }

  // --- Request ---

  get method(): HTTPMethod {
    if (!this._method) {
      this._method = (
        this.node.req.method || "GET"
      ).toUpperCase() as HTTPMethod;
    }
    return this._method;
  }

  get path() {
    return this._path || this.node.req.url || "/";
  }

  get headers(): Headers {
    if (!this._headers) {
      this._headers = _normalizeNodeHeaders(this.node.req.headers);
    }
    return this._headers;
  }

  // --- Respoonse ---

  get handled(): boolean {
    return (
      this._handled || this.node.res.writableEnded || this.node.res.headersSent
    );
  }

  respondWith(response: Response | PromiseLike<Response>): Promise<void> {
    return Promise.resolve(response).then((_response) =>
      sendWebResponse(this, _response),
    );
  }

  // --- Utils ---

  toString() {
    return `[${this.method}] ${this.path}`;
  }

  toJSON() {
    return this.toString();
  }

  // --- Deprecated ---

  /** @deprecated Please use `event.node.req` instead. */
  get req() {
    return this.node.req;
  }

  /** @deprecated Please use `event.node.res` instead. */
  get res() {
    return this.node.res;
  }
}

/**
 * Checks if the input is an H3Event object.
 * @param input - The input to check.
 * @returns True if the input is an H3Event object, false otherwise.
 * @see H3Event
 */
export function isEvent(input: any): input is H3Event {
  return hasProp(input, "__is_event__");
}

/**
 * Creates a new H3Event instance from the given Node.js request and response objects.
 * @param req - The NodeIncomingMessage object.
 * @param res - The NodeServerResponse object.
 * @returns A new H3Event instance.
 * @see H3Event
 */
export function createEvent(
  req: NodeIncomingMessage,
  res: NodeServerResponse,
): H3Event {
  return new H3Event(req, res);
}

// --- Internal ---

function _normalizeNodeHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}
