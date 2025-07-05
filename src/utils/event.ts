import { H3Event } from "../event.ts";
import type { H3EventContext } from "../types/context.ts";

/**
 * Checks if the input is an H3Event object.
 * @param input - The input to check.
 * @returns True if the input is an H3Event object, false otherwise.
 * @see H3Event
 */
export function isEvent(input: any): input is H3Event {
  return input instanceof H3Event || input?.constructor?.__is_event__;
}

export function mockEvent(
  _request: string | URL | Request,
  options?: RequestInit & { h3?: H3EventContext },
): H3Event {
  let request: Request;
  if (typeof _request === "string") {
    let url = _request;
    if (url[0] === "/") {
      url = `http://localhost${url}`;
    }
    request = new Request(url, options);
  } else if (options || _request instanceof URL) {
    request = new Request(_request, options);
  } else {
    request = _request;
  }
  return new H3Event(request);
}
