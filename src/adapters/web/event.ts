import type { H3Event, H3EventContext } from "../../types";
import type { H3EventResponse } from "../../types/event";
import { BaseEvent } from "../base/event";

export class WebEvent extends BaseEvent implements H3Event {
  request: Request;
  response: H3EventResponse;

  _url?: URL;

  constructor(request: Request, context?: H3EventContext) {
    super(context);
    this.request = request;
    this.response = new WebEventResponse();
  }

  get url() {
    if (!this._url) {
      this._url = new URL(this.request.url);
    }
    return this._url;
  }

  get pathname() {
    if (this._url) {
      return this._url.pathname; // reuse parsed URL
    }
    const url = this.request.url;
    const protoIndex = url.indexOf("://");
    if (protoIndex === -1) {
      return this.url.pathname; // deoptimize
    }
    const pIndex = url.indexOf("/", protoIndex + 4 /* ://* */);
    if (pIndex === -1) {
      return this.url.pathname; // deoptimize
    }
    const qIndex = url.indexOf("?", pIndex);
    return url.slice(pIndex, qIndex === -1 ? undefined : qIndex);
  }
}

class WebEventResponse implements H3EventResponse {
  _headersInit: Record<string, string> = Object.create(null);
  _headers?: Headers;

  get headers() {
    if (!this._headers) {
      this._headers = new Headers(this._headersInit);
    }
    return this._headers;
  }

  setHeader(name: string, value: string): void {
    if (this._headers) {
      this._headers.set(name, value);
    } else {
      this._headersInit[name] = value;
    }
  }
}
