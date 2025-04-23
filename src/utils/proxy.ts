import type { H3Event } from "../event";
import type { H3EventContext, RequestHeaders } from "../types";
import { getRequestHeaders } from "./request";
import { splitCookiesString } from "./cookie";
import { sanitizeStatusMessage, sanitizeStatusCode } from "./sanitize";
import { getRequestWebStream, readRawBody } from "./body";
import { createError } from "../error";

export type Duplex = "half" | "full";

export interface ProxyOptions {
  headers?: RequestHeaders | HeadersInit;
  fetchOptions?: RequestInit & { duplex?: Duplex } & {
    ignoreResponseError?: boolean;
  };
  fetch?: typeof fetch;
  sendStream?: boolean;
  streamRequest?: boolean;
  cookieDomainRewrite?: string | Record<string, string>;
  cookiePathRewrite?: string | Record<string, string>;
  onResponse?: (event: H3Event, response: Response) => void;
}

const PayloadMethods = new Set(["PATCH", "POST", "PUT", "DELETE"]);
const ignoredHeaders = new Set([
  "transfer-encoding",
  "accept-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "host",
  "accept",
]);

/**
 * Proxy the incoming request to a target URL.
 */
export async function proxyRequest(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
) {
  // Request Body
  let body;
  let duplex: Duplex | undefined;
  if (PayloadMethods.has(event.method)) {
    if (opts.streamRequest) {
      body = getRequestWebStream(event);
      duplex = "half";
    } else {
      body = await readRawBody(event, false).catch(() => undefined);
    }
  }

  // Method
  const method = opts.fetchOptions?.method || event.method;

  // Headers
  const fetchHeaders = mergeHeaders(
    getProxyRequestHeaders(event, { host: target.startsWith("/") }),
    opts.fetchOptions?.headers,
    opts.headers,
  );

  return sendProxy(event, target, {
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
export async function sendProxy(
  event: H3Event,
  target: string,
  opts: ProxyOptions = {},
) {
  let response: Response | undefined;
  try {
    response = await _getFetch(opts.fetch)(target, {
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
  event.node.res.statusCode = sanitizeStatusCode(
    response.status,
    event.node.res.statusCode,
  );
  event.node.res.statusMessage = sanitizeStatusMessage(response.statusText);

  const cookies: string[] = [];

  for (const [key, value] of response.headers.entries()) {
    if (key === "content-encoding") {
      continue;
    }
    if (key === "content-length") {
      continue;
    }
    if (key === "set-cookie") {
      cookies.push(...splitCookiesString(value));
      continue;
    }
    event.node.res.setHeader(key, value);
  }

  if (cookies.length > 0) {
    event.node.res.setHeader(
      "set-cookie",
      cookies.map((cookie) => {
        if (opts.cookieDomainRewrite) {
          cookie = rewriteCookieProperty(
            cookie,
            opts.cookieDomainRewrite,
            "domain",
          );
        }
        if (opts.cookiePathRewrite) {
          cookie = rewriteCookieProperty(
            cookie,
            opts.cookiePathRewrite,
            "path",
          );
        }
        return cookie;
      }),
    );
  }

  if (opts.onResponse) {
    await opts.onResponse(event, response);
  }

  // Directly send consumed _data
  if ((response as any)._data !== undefined) {
    return (response as any)._data;
  }

  // Ensure event is not handled
  if (event.handled) {
    return;
  }

  // Send at once
  if (opts.sendStream === false) {
    const data = new Uint8Array(await response.arrayBuffer());
    return event.node.res.end(data);
  }

  // Send as stream
  if (response.body) {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      event.node.res.write(chunk);
    }
  }
  return event.node.res.end();
}

/**
 * Get the request headers object without headers known to cause issues when proxying.
 */
export function getProxyRequestHeaders(
  event: H3Event,
  opts?: { host?: boolean },
) {
  const headers = Object.create(null);
  const reqHeaders = getRequestHeaders(event);
  for (const name in reqHeaders) {
    if (!ignoredHeaders.has(name) || (name === "host" && opts?.host)) {
      headers[name] = reqHeaders[name];
    }
  }
  return headers;
}

/**
 * Make a fetch request with the event's context and headers.
 */
export function fetchWithEvent<
  T = unknown,
  _R = any,
  F extends (req: RequestInfo | URL, opts?: any) => any = typeof fetch,
>(
  event: H3Event,
  req: RequestInfo | URL,
  init?: RequestInit & { context?: H3EventContext },
  options?: { fetch: F },
): unknown extends T ? ReturnType<F> : T {
  return _getFetch(options?.fetch)(req, <RequestInit>{
    ...init,
    context: init?.context || event.context,
    headers: {
      ...getProxyRequestHeaders(event, {
        host: typeof req === "string" && req.startsWith("/"),
      }),
      ...init?.headers,
    },
  });
}

// -- internal utils --

function _getFetch<T = typeof fetch>(_fetch?: T) {
  if (_fetch) {
    return _fetch;
  }
  if (globalThis.fetch) {
    return globalThis.fetch;
  }
  throw new Error(
    "fetch is not available. Try importing `node-fetch-native/polyfill` for Node.js.",
  );
}

function rewriteCookieProperty(
  header: string,
  map: string | Record<string, string>,
  property: string,
) {
  const _map = typeof map === "string" ? { "*": map } : map;
  return header.replace(
    new RegExp(`(;\\s*${property}=)([^;]+)`, "gi"),
    (match, prefix, previousValue) => {
      let newValue;
      if (previousValue in _map) {
        newValue = _map[previousValue];
      } else if ("*" in _map) {
        newValue = _map["*"];
      } else {
        return match;
      }
      return newValue ? prefix + newValue : "";
    },
  );
}

function mergeHeaders(
  defaults: HeadersInit,
  ...inputs: (HeadersInit | RequestHeaders | undefined)[]
) {
  const _inputs = inputs.filter(Boolean) as HeadersInit[];
  if (_inputs.length === 0) {
    return defaults;
  }
  const merged = new Headers(defaults);
  for (const input of _inputs) {
    const entries =
      typeof input.entries === "function"
        ? input.entries()
        : Object.entries(input);
    for (const [key, value] of entries) {
      if (value !== undefined) {
        merged.set(key.toString(), value);
      }
    }
  }
  return merged;
}
