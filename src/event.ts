import type { ServerRequest, ServerRuntimeContext } from "srvx";
import type { H3Event as H3EventT, H3EventContext } from "./types/event.ts";

import { EmptyObject } from "./utils/internal/obj.ts";
import { FastURL } from "srvx";

export class H3Event implements H3EventT {
  static __is_event__ = true;

  req: ServerRequest;
  url: URL;
  context: H3EventContext;
  _res?: H3EventResponse;

  constructor(req: ServerRequest, context?: H3EventContext) {
    this.context = context || new EmptyObject();
    this.req = req;
    // Parsed URL can be provided by srvx (node) and other runtimes
    const _url = (req as { _url?: URL })._url;
    this.url = _url && _url instanceof URL ? _url : new FastURL(req.url);
  }

  get res(): H3EventResponse {
    if (!this._res) {
      this._res = new H3EventResponse();
    }
    return this._res;
  }

  get path(): string {
    return this.url.pathname + this.url.search;
  }

  get method(): string {
    return this.req.method;
  }

  get headers(): Headers {
    return this.req.headers;
  }

  get runtime(): ServerRuntimeContext | undefined {
    return this.req.runtime;
  }

  get node(): ServerRuntimeContext["node"] | undefined {
    return this.req.runtime?.node;
  }

  toString(): string {
    return `[${this.req.method}] ${this.req.url}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

class H3EventResponse {
  status?: number;
  // statusText?: string;
  _headers?: Headers;
  get headers(): Headers {
    if (!this._headers) {
      this._headers = new Headers();
    }
    return this._headers;
  }
}
