import type { H3Event } from "../event.ts";

import { HTTPError } from "../error.ts";
import {
  abortable,
  applyXForwardedHeaders,
  ignoredHeaders,
  ignoredResponseHeaders,
  mergeHeaders,
  rewriteCookieProperty,
  rewriteLocationHeaders,
} from "./internal/proxy.ts";
import { EmptyObject } from "./internal/obj.ts";
import type { ServerRequest } from "srvx";
import { HTTPResponse } from "../response.ts";

export interface ProxyOptions {
  headers?: HeadersInit;
  /**
   * Allowlist of incoming request header names to forward to the upstream.
   * Header names are matched case-insensitively.
   *
   * Note: this bypasses the built-in hop-by-hop denylist — e.g.
   * `forwardHeaders: ["host"]` forwards the client's `host` verbatim.
   */
  forwardHeaders?: string[];
  /**
   * Denylist of incoming request header names to drop before proxying.
   * Header names are matched case-insensitively.
   */
  filterHeaders?: string[];
  /**
   * Options forwarded to the underlying `fetch()` call.
   *
   * Upstream 3xx responses are passed through to the client by default
   * (`redirect: "manual"`) rather than followed. Set
   * `fetchOptions: { redirect: "follow" }` to restore following redirects — but
   * note that following a redirect for a request with a streamed body can fail,
   * since the body cannot be replayed once it has been consumed.
   */
  fetchOptions?: RequestInit & { duplex?: "half" | "full" };
  cookieDomainRewrite?: string | Record<string, string>;
  cookiePathRewrite?: string | Record<string, string>;
  /**
   * Rewrite `location` and `refresh` response headers, like nginx
   * `proxy_redirect`:
   *
   * - `true` (default): a URL whose origin matches the proxy `target` is
   *   rewritten to the proxy's own origin (path and query preserved), so
   *   client-side redirects keep flowing through the proxy instead of
   *   exposing the upstream host. Relative and third-party URLs are left
   *   untouched, as are internal (`/`-prefixed) targets, which already share
   *   the proxy origin.
   * - A record maps URL prefixes to replacements (nginx
   *   `proxy_redirect <from> <to>`); the first matching prefix is replaced,
   *   e.g. `{ "https://upstream.example/two/": "/one/" }`. Only the explicit
   *   mappings apply in this mode (including for internal targets).
   * - `false`: forward these headers verbatim.
   *
   * @default true
   */
  locationRewrite?: boolean | Record<string, string>;
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
   * (e.g. to run cleanup). This also applies to a custom `fetchOptions.signal`,
   * except when it aborts with a `TimeoutError` — timeouts always map to `504`
   * (see `timeout`).
   */
  propagateAbortError?: boolean;

  /**
   * Milliseconds to wait for the upstream response (headers) before giving up.
   * On timeout the proxy responds with `504 Gateway Timeout`. The deadline is
   * cleared once the upstream responds — it never cuts off a long-running
   * response body stream.
   *
   * Because a fired timeout aborts with a `TimeoutError`, a caller-supplied
   * `fetchOptions.signal` that is itself an `AbortSignal.timeout` is also
   * mapped to `504` (rather than the `499` used for client disconnects) — note
   * that such a signal stays armed during body streaming and can truncate it;
   * prefer this option.
   */
  timeout?: number;

  /**
   * When `true`, add `x-forwarded-*` request headers derived from the incoming
   * request so the upstream learns the client and original request info:
   *
   * - `x-forwarded-for`: the client IP (`event.req.ip`, when available).
   * - `x-forwarded-proto`: the incoming request protocol.
   * - `x-forwarded-host`: the original host (incl. port).
   * - `x-forwarded-port`: the original port (or the protocol default — `443` for
   *   https, `80` for http).
   *
   * Each header is only set when absent — a value already present on the
   * incoming request (or set via header options) is left untouched.
   *
   * **Security:** because present values win, a client-supplied
   * `x-forwarded-for` is forwarded verbatim and the real client IP is never
   * added. On an internet-facing server (no trusted proxy in front), strip
   * incoming values first with `filterHeaders: ["x-forwarded-for"]` if the
   * upstream trusts this header for allowlisting, rate limiting, or logging.
   *
   * Only applied by `proxyRequest` (which forwards the incoming request);
   * the lower-level `proxy` ignores this option.
   *
   * @default false
   */
  xfwd?: boolean;
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
 * Upstream 3xx responses are passed through to the client by default rather than
 * followed. Set `fetchOptions: { redirect: "follow" }` to follow them instead —
 * but following a redirect with a streamed request body can fail, since the body
 * cannot be replayed once consumed.
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
  // Forward the body based on presence, not a method allowlist, so bodies on
  // WebDAV-style (PROPFIND/REPORT/SEARCH) and custom methods are not dropped.
  // GET/HEAD are excluded — keyed off the OUTGOING method (a caller can
  // override it via `fetchOptions.method`) because fetch rejects a body on
  // those methods.
  const method = opts.fetchOptions?.method || event.req.method;
  const methodUpper = method.toUpperCase();
  const incomingBody = event.req.body;
  const requestBody =
    incomingBody != null && methodUpper !== "GET" && methodUpper !== "HEAD"
      ? incomingBody
      : undefined;

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

  // When the forwarded body is not the incoming request's own stream, the
  // incoming `content-length` no longer describes it — and fetch trusts a
  // caller-supplied `content-length` verbatim, mis-framing the upstream
  // request. Drop it and let fetch derive the framing from the actual body.
  if ((opts.fetchOptions && "body" in opts.fetchOptions) || (incomingBody && !requestBody)) {
    if (fetchHeaders instanceof Headers) {
      fetchHeaders.delete("content-length");
    } else if (!Array.isArray(fetchHeaders)) {
      delete (fetchHeaders as Record<string, string>)["content-length"];
    }
  }

  // Derive `duplex` from the FINAL body (a caller may override it via
  // `opts.fetchOptions.body`), so a streamed override on a body-less incoming
  // request still sets `duplex` and fetch does not throw. An explicit
  // `opts.fetchOptions.duplex` still wins.
  const fetchBody = opts.fetchOptions?.body ?? requestBody;

  return proxy(event, target, {
    ...opts,
    fetchOptions: {
      method,
      body: requestBody,
      ...opts.fetchOptions,
      duplex: opts.fetchOptions?.duplex ?? (fetchBody != null ? "half" : undefined),
      headers: opts.xfwd ? applyXForwardedHeaders(fetchHeaders, event) : fetchHeaders,
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
 * Upstream 3xx responses are passed through to the client by default rather than
 * followed. Set `fetchOptions: { redirect: "follow" }` to follow them instead —
 * but following a redirect with a streamed request body can fail, since the body
 * cannot be replayed once consumed. (Internal sub-requests via `event.app.fetch()`
 * never follow redirects.)
 *
 * **Limitations** (inherited from `fetch`): upstream response bodies are always
 * decompressed (compression is not preserved end-to-end), the `host` header is
 * rewritten to the target (preserving it via `forwardHeaders: ["host"]` works on
 * Node.js but may be ignored on other runtimes), and unix sockets, TLS options,
 * or connection agents require a runtime-specific escape hatch (e.g. undici's
 * `dispatcher` in `fetchOptions` on Node.js). On browser and service-worker
 * runtimes, `redirect: "manual"` produces an unrelayable opaque-redirect for
 * external targets (a `502` is returned) — set
 * `fetchOptions: { redirect: "follow" }` there.
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
  // Optionally add a timeout signal so a slow upstream maps to `504` instead of
  // hanging. Combine every applicable signal (client, caller, timeout) so any of
  // them aborting aborts the request, without dropping `event.req.signal`.
  const signals: AbortSignal[] = [event.req.signal];
  if (opts.fetchOptions?.signal) {
    signals.push(opts.fetchOptions.signal);
  }
  // A cancelable timer (not `AbortSignal.timeout`) so the deadline only covers
  // waiting for the response: it is cleared as soon as the upstream responds
  // and can never abort a long-running body stream mid-flight.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeout! > 0 && Number.isFinite(opts.timeout)) {
    const timeoutController = new AbortController();
    timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException("Proxy request timed out", "TimeoutError")),
      // setTimeout clamps anything above its int32 limit down to 1ms — treat
      // larger deadlines as "practically no timeout" instead.
      Math.min(Math.trunc(opts.timeout!), 2_147_483_647),
    );
    signals.push(timeoutController.signal);
  }
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]!;
  const fetchOptions: RequestInit = {
    headers: opts.headers as HeadersInit,
    ...opts.fetchOptions,
    // Default to passing upstream 3xx responses through to the client instead
    // of silently following them. `?? "manual"` (instead of a default before
    // the spread) so even an explicit `redirect: undefined` cannot silently
    // restore fetch's follow behavior.
    redirect: opts.fetchOptions?.redirect ?? "manual",
    signal,
  };

  let response: Response | undefined;
  try {
    // `H3.fetch()` does not observe the request signal, so race internal
    // sub-requests against it explicitly — otherwise `timeout` and client
    // disconnects would be silent no-ops for internal (`/`) targets.
    response =
      target[0] === "/"
        ? await abortable(
            () => event.app!.fetch(createSubRequest(event, target, fetchOptions)),
            signal,
          )
        : await fetch(target, fetchOptions);
  } catch (error) {
    // A fired timeout signal aborts with a `TimeoutError`. Map it (including a
    // caller-supplied `AbortSignal.timeout`) to `504 Gateway Timeout`, never the
    // `499`/propagation path used for client disconnects.
    if ((error as Error)?.name === "TimeoutError") {
      throw new HTTPError({ status: 504, statusText: "Gateway Timeout", cause: error });
    }
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
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }

  // Browser/service-worker fetch filters `redirect: "manual"` 3xx responses
  // into an opaque-redirect (status 0, no headers) that cannot be relayed.
  // Fail loudly instead of returning an empty response.
  if (response.type === "opaqueredirect") {
    throw new HTTPError({
      status: 502,
      message:
        'Cannot relay an opaque redirect response on this runtime. Set `fetchOptions: { redirect: "follow" }` to follow upstream redirects instead.',
    });
  }

  const headers = new Headers();

  // Also strip response headers the upstream marked hop-by-hop via its
  // `Connection` header (RFC 7230 §6.1), on top of the static denylist.
  const connectionNominated = new Set(
    (response.headers.get("connection") || "")
      .toLowerCase()
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );

  for (const [key, value] of response.headers.entries()) {
    if (ignoredResponseHeaders.has(key) || connectionNominated.has(key) || key === "set-cookie") {
      continue;
    }
    headers.append(key, value);
  }

  // `getSetCookie()` is the only spec-guaranteed way to get each `set-cookie`
  // value separately (cookie attributes may contain commas).
  const cookies = response.headers.getSetCookie();
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

  // Rewrite redirect-ish headers pointing at the target back to the proxy's
  // own origin, or per explicit prefix mappings (like nginx `proxy_redirect`),
  // so the client keeps talking to the proxy. In default mode internal (`/`)
  // targets are skipped: they already share the request origin.
  const locationRewrite = opts.locationRewrite ?? true;
  if (locationRewrite !== false && (locationRewrite !== true || target[0] !== "/")) {
    rewriteLocationHeaders(
      headers,
      locationRewrite,
      target[0] === "/" ? undefined : new URL(target).origin,
      event.url.origin,
    );
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
  // `Headers.entries()` yields lowercased names, so lowercase the option arrays
  // once up front to keep the allow/deny matching case-insensitive.
  const filterHeaders = opts?.filterHeaders?.map((h) => h.toLowerCase());
  const forwardHeaders = opts?.forwardHeaders?.map((h) => h.toLowerCase());
  for (const [name, value] of event.req.headers.entries()) {
    if (filterHeaders?.includes(name)) {
      continue;
    }

    if (forwardHeaders?.includes(name)) {
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
  // A ReadableStream body requires `duplex: "half"` or the Request constructor
  // throws on Node. Default it when a body is present and no duplex is set (e.g.
  // the `fetchWithEvent` path, which never sets it).
  if (init.body != null && (init as { duplex?: string }).duplex === undefined) {
    init = { ...init, duplex: "half" } as RequestInit;
  }
  const req = new Request(url, init) as ServerRequest;
  req.runtime = event.req.runtime;
  req.waitUntil = event.req.waitUntil;
  req.ip = event.req.ip;
  return req;
}
