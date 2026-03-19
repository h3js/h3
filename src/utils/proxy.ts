import type { H3Event } from "../event.ts";

import { HTTPError } from "../error.ts";
import {
  PayloadMethods,
  ignoredHeaders,
  mergeHeaders,
  rewriteCookieProperty,
} from "./internal/proxy.ts";
import { EmptyObject } from "./internal/obj.ts";
import type { ServerRequest } from "srvx";
import { HTTPResponse } from "../response.ts";

export interface ProxyOptions {
  headers?: HeadersInit;
  forwardHeaders?: string[];
  filterHeaders?: string[];
  fetchOptions?: RequestInit & { duplex?: "half" | "full" };
  cookieDomainRewrite?: string | Record<string, string>;
  cookiePathRewrite?: string | Record<string, string>;
  onResponse?: (event: H3Event, response: Response) => void;
}

/**
 * Proxy the incoming request to a target URL.
 *
 * If the `target` starts with `/`, the request is handled internally by the app router
 * via `event.app.fetch()` instead of making an external HTTP request.
 *
 * **Security:** Never pass unsanitized user input as the `target`. Callers are
 * responsible for validating and restricting the target URL (e.g. allowlisting
 * hosts, blocking internal paths, enforcing protocol). Consider using
 * `bodyLimit()` middleware to prevent large request bodies from consuming
 * excessive resources when proxying untrusted input.
 */
export async function proxyRequest(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
): Promise<HTTPResponse> {
  // Request Body
  const requestBody = PayloadMethods.has(event.req.method) ? event.req.body : undefined;

  // Method
  const method = opts.fetchOptions?.method || event.req.method;

  // Headers
  const fetchHeaders = mergeHeaders(
    getProxyRequestHeaders(event, {
      host: target.startsWith("/"),
      forwardHeaders: opts.forwardHeaders,
      filterHeaders: opts.filterHeaders,
    }),
    opts.fetchOptions?.headers,
    opts.headers,
  );

  return proxy(event, target, {
    ...opts,
    fetchOptions: {
      method,
      body: requestBody,
      duplex: requestBody ? "half" : undefined,
      ...opts.fetchOptions,
      headers: fetchHeaders,
    },
  });
}

/**
 * Make a proxy request to a target URL and send the response back to the client.
 *
 * If the `target` starts with `/`, the request is dispatched internally via
 * `event.app.fetch()` (sub-request) and never leaves the process. This bypasses
 * any external security layer (reverse proxy auth, IP allowlisting, mTLS).
 *
 * **Security:** Never pass unsanitized user input as the `target`. Callers are
 * responsible for validating and restricting the target URL (e.g. allowlisting
 * hosts, blocking internal paths, enforcing protocol).
 */
export async function proxy(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
): Promise<HTTPResponse> {
  const fetchOptions: RequestInit = {
    headers: opts.headers as HeadersInit,
    ...opts.fetchOptions,
  };

  let response: Response | undefined;
  try {
    response =
      target[0] === "/"
        ? await event.app!.fetch(createSubRequest(event, target, fetchOptions))
        : await fetch(target, fetchOptions);
  } catch (error) {
    throw new HTTPError({ status: 502, cause: error });
  }

  const headers = new Headers();

  const cookies: string[] = [];

  for (const [key, value] of response.headers.entries()) {
    if (key === "content-encoding" || key === "content-length" || key === "transfer-encoding") {
      continue;
    }
    if (key === "set-cookie") {
      cookies.push(value);
      continue;
    }
    headers.append(key, value);
  }

  if (cookies.length > 0) {
    const _cookies = cookies.map((cookie) => {
      if (opts.cookieDomainRewrite) {
        cookie = rewriteCookieProperty(cookie, opts.cookieDomainRewrite, "domain");
      }
      if (opts.cookiePathRewrite) {
        cookie = rewriteCookieProperty(cookie, opts.cookiePathRewrite, "path");
      }
      return cookie;
    });
    for (const cookie of _cookies) {
      headers.append("set-cookie", cookie);
    }
  }

  if (opts.onResponse) {
    await opts.onResponse(event, response);
  }

  return new HTTPResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Get the request headers object without headers known to cause issues when proxying.
 */
export function getProxyRequestHeaders(
  event: H3Event,
  opts?: {
    host?: boolean;
    forwardHeaders?: string[];
    filterHeaders?: string[];
  },
): Record<string, string> {
  const headers = new EmptyObject();
  for (const [name, value] of event.req.headers.entries()) {
    if (opts?.filterHeaders?.includes(name)) {
      continue;
    }

    if (opts?.forwardHeaders?.includes(name)) {
      headers[name] = value;
      continue;
    }

    if (!ignoredHeaders.has(name) || (name === "host" && opts?.host)) {
      headers[name] = value;
      continue;
    }
  }
  return headers;
}

/**
 * Make a fetch request with the event's context and headers.
 *
 * If the `url` starts with `/`, the request is dispatched internally via
 * `event.app.fetch()` (sub-request) and never leaves the process.
 *
 * **Security:** Never pass unsanitized user input as the `url`. Callers are
 * responsible for validating and restricting the URL.
 */
export async function fetchWithEvent(
  event: H3Event,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (url[0] !== "/") {
    return fetch(url, init);
  }
  return event.app!.fetch(
    createSubRequest(event, url, {
      ...init,
      headers: mergeHeaders(getProxyRequestHeaders(event, { host: true }), init?.headers),
    }),
  );
}

function createSubRequest(event: H3Event, path: string, init: RequestInit): ServerRequest {
  const url = new URL(path, event.url);
  const req = new Request(url, init) as ServerRequest;
  req.runtime = event.req.runtime;
  req.waitUntil = event.req.waitUntil;
  req.ip = event.req.ip;
  return req;
}
