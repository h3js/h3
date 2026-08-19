import { FastResponse } from "srvx";
import { HTTPError } from "./error.ts";
import { isJSONSerializable } from "./utils/internal/object.ts";
import { sanitizeStatusCode, sanitizeStatusMessage } from "./utils/sanitize.ts";
import { kEventDispose, type DisposeState } from "./utils/internal/dispose.ts";

import type { H3Config } from "./types/h3.ts";
import { kEventRes, kEventResHeaders, kEventResErrHeaders, type H3Event } from "./event.ts";

export const kNotFound: symbol = /* @__PURE__ */ Symbol.for("h3.notFound");
export const kHandled: symbol = /* @__PURE__ */ Symbol.for("h3.handled");

export function toResponse(
  val: unknown,
  event: H3Event,
  config: H3Config = {},
): Response | Promise<Response> {
  if (typeof (val as PromiseLike<unknown>)?.then === "function") {
    return (val as Promise<unknown>).then(
      (resolvedVal) => toResponse(resolvedVal, event, config),
      (r) => toResponse(toError(r), event, config),
    ) as Promise<Response>;
  }

  let response: Response | Promise<Response>;
  try {
    response = prepareResponse(val, event, config);
  } catch (error) {
    return toResponse(toError(error), event, config);
  }
  if (typeof (response as PromiseLike<Response>)?.then === "function") {
    return toResponse(response, event, config);
  }

  const { onResponse } = config;
  if (onResponse) {
    // onResponse is a terminal side-effect hook (returns void). A throw/rejection here must not
    // escape the lifecycle (onError already ran); absorb and log it (consistent with dispose
    // callbacks), then still return the already-built response. The hook is invoked inside `.then`
    // so a synchronous throw is caught too (not just a rejected promise).
    return Promise.resolve()
      .then(() => onResponse(response as Response, event))
      .catch((error) => {
        if (!config.silent) console.error(error);
      })
      .then(
        () =>
          ((event as any)[kEventDispose] as DisposeState | undefined)?.observe(
            response as Response,
            val,
          ) ?? (response as Response),
      );
  }
  return (
    ((event as any)[kEventDispose] as DisposeState | undefined)?.observe(
      response as Response,
      val,
    ) ?? (response as Response)
  );
}

/**
 * Normalize a thrown or rejected value before rendering it as a response.
 *
 * Errors and the internal sentinels are passed through, and numbers are coerced to a status code
 * (`throw 404`). Anything else — an object, a string, `undefined` — is wrapped into an unhandled
 * 500, so it is logged instead of being rendered as a successful response body.
 *
 * Nothing is taken from the thrown value: `status`, `message`, `data`, `statusText` and `headers`
 * are all dropped, and the value is kept as `cause`, which is never serialized. A non-Error object
 * is never trusted to shape the response, not even via a `status` shorthand.
 */
export function toError(value: unknown): unknown {
  if (value === kNotFound || value === kHandled || value instanceof Error) {
    return value;
  }
  if (typeof value === "number") {
    return new HTTPError({ status: value });
  }
  const error = new HTTPError({ status: 500, unhandled: true });
  (error as { cause: unknown }).cause = value;
  return error;
}

/**
 * Brand for {@link HTTPResponse}, checked instead of `constructor.name`.
 *
 * A duck-typed name check is forgeable from untrusted input: `JSON.parse` creates an *own*
 * `constructor` property, so a request body like `{"constructor":{"name":"HTTPResponse"}}` echoed
 * back by a handler would be accepted as a response descriptor and get to pick the response body,
 * headers and status. A registry symbol cannot appear in JSON while still matching across
 * duplicate module instances (multiple h3 copies, realms).
 */
const kHTTPResponse: unique symbol = /* @__PURE__ */ Symbol.for("h3.HTTPResponse");

export class HTTPResponse {
  #headers?: Headers;
  #init?: Pick<ResponseInit, "status" | "statusText" | "headers"> | undefined;
  body?: BodyInit | null;
  constructor(
    body: BodyInit | null,
    init?: Pick<ResponseInit, "status" | "statusText" | "headers">,
  ) {
    this.body = body;
    this.#init = init;
  }
  /**
   * Status of the response, or `undefined` when unset.
   *
   * Unset means "inherit": the status staged on `event.res.status` is used, falling back to `200`.
   * Defaulting to `200` here instead would make an untouched `HTTPResponse` indistinguishable from
   * one explicitly built with `{ status: 200 }`, and always win over `event.res`.
   */
  get status(): number | undefined {
    return this.#init?.status;
  }
  /** Status text of the response, or `undefined` when unset. See {@link HTTPResponse.status}. */
  get statusText(): string | undefined {
    return this.#init?.statusText;
  }
  get headers(): Headers {
    return (this.#headers ||= new Headers(this.#init?.headers));
  }
}

// Assigned on the prototype (not as a class field) to keep it out of the public type surface.
(HTTPResponse.prototype as any)[kHTTPResponse] = true;

function prepareResponse(
  val: unknown,
  event: H3Event,
  config: H3Config,
  nested?: boolean,
): Response | Promise<Response> {
  if (val === kHandled) {
    return new FastResponse(null);
  }

  if (val === kNotFound) {
    val = new HTTPError({
      status: 404,
      message: `Cannot find any route matching [${event.req.method}] ${event.url}`,
    });
  }

  if (val && val instanceof Error) {
    const isHTTPError = HTTPError.isError(val);
    const error = isHTTPError ? (val as HTTPError) : new HTTPError(val);
    if (!isHTTPError) {
      // @ts-expect-error unhandled is readonly for public interface
      error.unhandled = true;
      if (val?.stack) {
        error.stack = val.stack;
      }
    }
    if (error.unhandled && !config.silent) {
      console.error(error);
    }
    const { onError } = config;
    const errHeaders: Headers | undefined = (event as any)[kEventRes]?.[kEventResErrHeaders];
    if (onError && !nested) {
      return Promise.resolve()
        .catch(toError)
        .then((newVal) => prepareResponse(newVal ?? val, event, config, true));
    }
    // `errorResponse` merges `errHeaders` into the response it builds, so clear the
    // prepared response before rendering. With `onError` configured the rendered
    // Response is passed back through `prepareResponse`, which would otherwise merge
    // `errHeaders` a second time — harmless for single-valued headers (`set`), but
    // `set-cookie` is appended and would be duplicated.
    (event as any)[kEventRes] = undefined;
    return errorResponse(error, config.debug, errHeaders);
  }

  // Only set if event.res.headers is accessed
  const preparedRes:
    | undefined
    | {
        status?: number;
        statusText?: string;
        [kEventResHeaders]?: Headers;
        [kEventResErrHeaders]?: Headers;
      } = (event as any)[kEventRes];
  let preparedHeaders = preparedRes?.[kEventResHeaders];
  (event as any)[kEventRes] = undefined; // Clear prepared response to avoid duplication

  if (!(val instanceof Response)) {
    const res = prepareResponseBody(val, event, config);
    // Sanitize on the way out: `event.res.status`/`statusText` and `HTTPResponse` are plain
    // user-writable fields, and `FastResponse` defers validation to the runtime. An invalid value
    // then throws from Node's `writeHead()` — after `toResponse` returned, so outside every h3
    // try/catch — and takes the process down; on runtimes that do not validate the reason phrase,
    // a CRLF in `statusText` is response splitting.
    const rawStatus = res.status || preparedRes?.status;
    const status = rawStatus ? sanitizeStatusCode(rawStatus) : undefined;
    const rawStatusText = res.statusText || preparedRes?.statusText;
    return new FastResponse(nullBody(event.req.method, status) ? null : res.body, {
      status,
      statusText: rawStatusText === undefined ? undefined : sanitizeStatusMessage(rawStatusText),
      headers:
        res.headers && preparedHeaders
          ? mergeHeaders(res.headers, preparedHeaders)
          : res.headers || preparedHeaders,
    });
  }

  // Success and redirect responses receive all prepared headers.
  // Error responses (4xx/5xx) only receive headers explicitly staged as `event.res.errHeaders`
  // to avoid leaking success-only headers (caching, content negotiation, ...) into errors.
  if (val.status >= 400) {
    preparedHeaders = preparedRes?.[kEventResErrHeaders];
  }

  // Merge prepared headers unless there is nothing to merge or a custom error
  // render is returned from `onError`. `event.res.headers` is created lazily on first
  // access, so it can be present but empty -- nothing to merge then either.
  if (preparedHeaders && !nested && !preparedHeaders.keys().next().done) {
    // Never merge *into* `val.headers`: the handler owns that `Response` and may reuse it
    // (module-level constant, memoized fallback, ...). Merging in place makes
    // request-scoped headers stick to it permanently, and because `set-cookie` is
    // appended rather than set, one request's session cookie would then be re-emitted to
    // every later client receiving that same object. Build a new response instead.
    return new FastResponse(nullBody(event.req.method, val.status) ? null : val.body, {
      status: val.status,
      statusText: val.statusText,
      headers: mergeHeaders(val.headers, preparedHeaders),
    }) as Response;
  }

  // Strip the body for HEAD requests (runtimes usually do this, but keep
  // self-consistent for web-mode / service-worker consumers). Covers the
  // in-place merge path above, which previously returned the body intact.
  return event.req.method === "HEAD" && val.body !== null
    ? (new FastResponse(null, {
        status: val.status,
        statusText: val.statusText,
        headers: val.headers,
      }) as Response)
    : val;
}

function mergeHeaders(base: HeadersInit, overrides: Headers, target = new Headers(base)): Headers {
  for (const [name, value] of overrides) {
    if (name === "set-cookie") {
      target.append(name, value);
    } else {
      target.set(name, value);
    }
  }
  return target;
}

const frozen =
  (name: string) =>
  (...args: any[]) => {
    throw new Error(`Headers are frozen (${name} ${args.join(", ")})`);
  };

class FrozenHeaders extends Headers {
  override set = frozen("set");
  override append = frozen("append");
  override delete = frozen("delete");
}

const emptyHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-length": "0",
});

const jsonHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/json;charset=UTF-8",
});

function prepareResponseBody(
  val: unknown,
  event: H3Event,
  config: H3Config,
): Partial<HTTPResponse> {
  // Empty Content
  if (val === null || val === undefined) {
    return { body: "", headers: emptyHeaders };
  }

  const valType = typeof val;

  // Text
  if (valType === "string") {
    // Default header is text/plain we don't set it for performance reasons
    // new Response("").headers.get('content-type') === "text/plain;charset=UTF-8"
    return { body: val as string };
  }

  // Buffer (should be before JSON)
  if (val instanceof Uint8Array) {
    // Set on the returned headers, not `event.res` (already cleared by the caller):
    // writing to `event.res.headers` here would recreate it post-clear and be discarded.
    return {
      body: val as BufferSource,
      headers: new Headers({ "content-length": val.byteLength.toString() }),
    };
  }

  // Partial Response
  if (val instanceof HTTPResponse || (val as any)?.[kHTTPResponse] === true) {
    return val;
  }

  // JSON
  if (isJSONSerializable(val, valType)) {
    return {
      body: JSON.stringify(val, undefined, config.debug ? 2 : undefined),
      headers: jsonHeaders,
    };
  }

  // BigInt
  if (valType === "bigint") {
    return { body: val.toString(), headers: jsonHeaders };
  }

  // Blob
  if (val instanceof Blob) {
    const headers = new Headers({
      "content-type": val.type,
      "content-length": val.size.toString(),
    });

    // File
    let filename = (val as File).name;
    if (filename) {
      filename = encodeURIComponent(filename);
      // Omit the disposition type ("inline" or "attachment") and let the client (browser) decide.
      headers.set("content-disposition", `filename="${filename}"; filename*=UTF-8''${filename}`);
    }

    return { body: val.stream(), headers };
  }

  // Symbol or Function
  if (valType === "symbol") {
    return { body: val.toString() };
  }
  if (valType === "function") {
    return { body: `${(val as () => unknown).name}()` };
  }

  return { body: val as BodyInit };
}

function nullBody(method: string, status: number | undefined): boolean | 0 | undefined {
  // prettier-ignore
  return (method === "HEAD" ||
    status === 100 || status === 101 || status === 102 ||
    status === 204 || status === 205 || status === 304
  )
}

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = error.headers
    ? mergeHeaders(jsonHeaders, error.headers)
    : new Headers(jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...error.toJSON(),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    {
      status: error.status,
      statusText: error.statusText,
      headers,
    },
  );
}
