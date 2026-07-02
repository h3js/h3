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
  onResponse?: (event: H3Event, response: Response) => void | Promise<void>;
  /**
   * Control how a client disconnect is handled.
   *
   * The incoming request's abort signal (`event.req.signal`) is always forwarded
   * to the proxied request, so a client disconnect aborts the upstream request
   * and releases its connection. By default the resulting abort is handled
   * quietly with a `499 Client Closed Request` response (never delivered, since
   * the client is already gone) rather than logged as a `502` gateway error.
   *
   * Set this to `true` to instead let the `AbortError` propagate to your handler
   * (e.g. to run cleanup). This also applies to a custom `fetchOptions.signal`.
   */
  propagateAbortError?: boolean;
}

/**
 * Proxy the incoming request to a target URL.
 *
 * If the `target` starts with `/`, the request is handled internally by the app router
 * via `event.app.fetch()` instead of making an external HTTP request.
 *
 * The request body is streamed to the target without buffering. Per the Fetch
 * standard, a request body can only be consumed once, so reading it beforehand
 * (e.g. via `readBody()`, `readFormData()`, or body-reading middleware) locks
 * the stream and proxying fails. If you need to inspect the body and still
 * proxy it, read from a clone and leave the original event untouched.
 *
 * **Security:** Never pass unsanitized user input as the `target`. Callers are
 * responsible for validating and restricting the target URL (e.g. allowlisting
 * hosts, blocking internal paths, enforcing protocol). Consider using
 * `bodyLimit()` middleware to prevent large request bodies from consuming
 * excessive resources when proxying untrusted input.
 *
 * @example
 * app.all("/proxy", async (event) => {
 *   const body = await event.req.clone().json(); // read from the clone
 *   // ...inspect body...
 *   return proxyRequest(event, "/target"); // original stream still intact
 * });
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
  // Always forward the client's abort signal so a disconnect aborts the
  // upstream request and releases its connection. If the caller also supplied
  // `fetchOptions.signal`, honor both (either aborting aborts the request)
  // instead of letting the spread silently drop `event.req.signal`.
  const callerSignal = opts.fetchOptions?.signal;
  const fetchOptions: RequestInit = {
    headers: opts.headers as HeadersInit,
    ...opts.fetchOptions,
    signal: callerSignal ? AbortSignal.any([event.req.signal, callerSignal]) : event.req.signal,
  };

  let response: Response | undefined;
  try {
    response =
      target[0] === "/"
        ? await event.app!.fetch(createSubRequest(event, target, fetchOptions))
        : await fetch(target, fetchOptions);
  } catch (error) {
    // Key off the error itself (not `event.req.signal.aborted`) so an abort is
    // detected even with a custom `fetchOptions.signal`, and a real upstream
    // failure is never mistaken for an abort.
    if ((error as Error)?.name === "AbortError") {
      // Opted in: surface the abort as-is so the caller can handle it.
      if (opts.propagateAbortError) {
        throw error;
      }
      // Default: a client disconnect is not a gateway failure. Respond quietly
      // instead of throwing a 502 for every dropped connection (the response is
      // never delivered — the client is already gone).
      if (event.req.signal.aborted) {
        return new HTTPResponse(null, { status: 499, statusText: "Client Closed Request" });
      }
    }
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

  // Stream the upstream body through natively so the common case has zero
  // overhead. A client disconnect during streaming aborts the forwarded
  // `event.req.signal`, which errors the upstream body; that error is delivered
  // to whoever consumes the stream — the server runtime, which is already
  // tearing down the now-closed connection — so it needs no special handling
  // here and never becomes a gateway (502) error.
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
