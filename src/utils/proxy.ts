import type { H3EventContext, H3Event } from "../types/event.ts";
import { splitSetCookieString } from "cookie-es";
import { sanitizeStatusMessage, sanitizeStatusCode } from "./sanitize.ts";
import { createError } from "../error.ts";
import {
  PayloadMethods,
  getFetch,
  ignoredHeaders,
  mergeHeaders,
  rewriteCookieProperty,
} from "./internal/proxy.ts";
import { EmptyObject } from "./internal/obj.ts";

export interface ProxyOptions {
  headers?: HeadersInit;
  fetchOptions?: RequestInit & { duplex?: "half" | "full" } & {
    ignoreResponseError?: boolean;
  };
  fetch?: typeof fetch;
  sendStream?: boolean;
  streamRequest?: boolean;
  cookieDomainRewrite?: string | Record<string, string>;
  cookiePathRewrite?: string | Record<string, string>;
  onResponse?: (event: H3Event, response: Response) => void;
}

/**
 * Proxy the incoming request to a target URL.
 */
export async function proxyRequest(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
): Promise<BodyInit | undefined | null> {
  // Request Body
  let body;
  let duplex: "half" | "full" | undefined;
  if (PayloadMethods.has(event.req.method)) {
    if (opts.streamRequest) {
      body = event.req.body;
      duplex = "half";
    } else {
      body = await event.req.arrayBuffer();
    }
  }

  // Method
  const method = opts.fetchOptions?.method || event.req.method;

  // Headers
  const fetchHeaders = mergeHeaders(
    getProxyRequestHeaders(event, { host: target.startsWith("/") }),
    opts.fetchOptions?.headers,
    opts.headers,
  );

  return proxy(event, target, {
    ...opts,
    fetchOptions: {
      method,
      body,
      duplex,
      ...opts.fetchOptions,
      headers: fetchHeaders,
    },
  });
}

/**
 * Make a proxy request to a target URL and send the response back to the client.
 */
export async function proxy(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
): Promise<BodyInit | undefined | null> {
  let response: Response | undefined;
  try {
    response = await getFetch(opts.fetch)(target, {
      headers: opts.headers as HeadersInit,
      ignoreResponseError: true, // make $ofetch.raw transparent
      ...opts.fetchOptions,
    });
  } catch (error) {
    throw createError({
      status: 502,
      statusMessage: "Bad Gateway",
      cause: error,
    });
  }
  event.res.status = sanitizeStatusCode(response.status, event.res.status);
  event.res.statusText = sanitizeStatusMessage(response.statusText);

  const cookies: string[] = [];

  for (const [key, value] of response.headers.entries()) {
    if (key === "content-encoding") {
      continue;
    }
    if (key === "content-length") {
      continue;
    }
    if (key === "set-cookie") {
      cookies.push(...splitSetCookieString(value));
      continue;
    }
    event.res.headers.set(key, value);
  }

  if (cookies.length > 0) {
    const _cookies = cookies.map((cookie) => {
      if (opts.cookieDomainRewrite) {
        cookie = rewriteCookieProperty(
          cookie,
          opts.cookieDomainRewrite,
          "domain",
        );
      }
      if (opts.cookiePathRewrite) {
        cookie = rewriteCookieProperty(cookie, opts.cookiePathRewrite, "path");
      }
      return cookie;
    });
    for (const cookie of _cookies) {
      event.res.headers.append("set-cookie", cookie);
    }
  }

  if (opts.onResponse) {
    await opts.onResponse(event, response);
  }

  // Directly send consumed _data
  if ((response as any)._data !== undefined) {
    return (response as any)._data;
  }

  // Send at once
  if (opts.sendStream === false) {
    return new Uint8Array(await response.arrayBuffer());
  }

  // Send as stream
  return response.body;
}

/**
 * Get the request headers object without headers known to cause issues when proxying.
 */
export function getProxyRequestHeaders(
  event: H3Event,
  opts?: { host?: boolean },
): Record<string, string> {
  const headers = new EmptyObject();
  for (const [name, value] of event.req.headers.entries()) {
    if (!ignoredHeaders.has(name) || (name === "host" && opts?.host)) {
      headers[name] = value;
    }
  }
  return headers;
}

/**
 * Make a fetch request with the event's context and headers.
 */
export function fetchWithEvent<
  T = unknown,
  _R = unknown,
  F extends (req: RequestInfo | URL, opts?: any) => any = typeof fetch,
>(
  event: H3Event,
  req: RequestInfo | URL,
  init?: RequestInit & { context?: H3EventContext },
  options?: { fetch: F },
): unknown extends T ? ReturnType<F> : T {
  return getFetch(options?.fetch)(req, {
    ...init,
    context: init?.context || event.context,
    headers: mergeHeaders(
      getProxyRequestHeaders(event, {
        host: typeof req === "string" && req.startsWith("/"),
      }),
      init?.headers,
    ),
  } satisfies RequestInit & {
    context?: H3EventContext;
  });
}
