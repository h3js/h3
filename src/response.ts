import { FastResponse } from "srvx";
import { HTTPError } from "./error.ts";
import { isJSONSerializable } from "./utils/internal/object.ts";

import type { H3Config } from "./types/h3.ts";
import { kEventRes, kEventResHeaders, type H3Event } from "./event.ts";

export const kNotFound: symbol = /* @__PURE__ */ Symbol.for("h3.notFound");
export const kHandled: symbol = /* @__PURE__ */ Symbol.for("h3.handled");

export function toResponse(
  val: unknown,
  event: H3Event,
  config: H3Config = {},
): Response | Promise<Response> {
  if (typeof (val as PromiseLike<unknown>)?.then === "function") {
    return (
      (val as Promise<unknown>).catch?.((error) => error) ||
      Promise.resolve(val)
    ).then((resolvedVal) =>
      toResponse(resolvedVal, event, config),
    ) as Promise<Response>;
  }

  const response = prepareResponse(val, event, config);
  if (typeof (response as PromiseLike<Response>)?.then === "function") {
    return toResponse(response, event, config);
  }

  const { onResponse } = config;
  return onResponse
    ? Promise.resolve(onResponse(response as Response, event)).then(
        () => response,
      )
    : response;
}

export class PseudoResponse {
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
  get status(): number {
    return this.#init?.status || 200;
  }
  get statusText(): string {
    return this.#init?.statusText || "OK";
  }
  get headers(): Headers {
    return (this.#headers ||= new Headers(this.#init?.headers));
  }
}

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
    return onError && !nested
      ? Promise.resolve(onError(error, event))
          .catch((error) => error)
          .then((newVal) => prepareResponse(newVal ?? val, event, config, true))
      : errorResponse(error, config.debug);
  }

  // Only set if event.res.headers is accessed
  const preparedRes:
    | undefined
    | { status?: number; statusText?: string; [kEventResHeaders]?: Headers } = (
    event as any
  )[kEventRes];
  const preparedHeaders = preparedRes?.[kEventResHeaders];

  if (!(val instanceof Response)) {
    const res = prepareResponseBody(val, event, config);
    const status = res.status || preparedRes?.status;
    return new FastResponse(
      nullBody(event.req.method, status) ? null : res.body,
      {
        status,
        statusText: res.statusText || preparedRes?.statusText,
        headers:
          res.headers && preparedHeaders
            ? mergeHeaders(res.headers, preparedHeaders)
            : res.headers || preparedHeaders,
      },
    );
  }

  // Note: Only check _headers. res.status/statusText are not used as we use them from the response
  if (!preparedHeaders) {
    return val; // Fast path: no headers to merge
  }
  return new FastResponse(
    nullBody(event.req.method, val.status) ? null : val.body,
    {
      status: val.status,
      statusText: val.statusText,
      headers: mergeHeaders(preparedHeaders, val.headers),
    },
  ) as Response;
}

function mergeHeaders(base: HeadersInit, merge: Headers): Headers {
  const mergedHeaders = new Headers(base);
  for (const [name, value] of merge) {
    if (name === "set-cookie") {
      mergedHeaders.append(name, value);
    } else {
      mergedHeaders.set(name, value);
    }
  }
  return mergedHeaders;
}

const emptyHeaders = /* @__PURE__ */ new Headers({ "content-length": "0" });

const jsonHeaders = /* @__PURE__ */ new Headers({
  "content-type": "application/json;charset=UTF-8",
});

function prepareResponseBody(
  val: unknown,
  event: H3Event,
  config: H3Config,
): Partial<PseudoResponse> {
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
    event.res.headers.set("content-length", val.byteLength.toString());
    return { body: val as BufferSource };
  }

  // Partial Response
  if (val instanceof PseudoResponse) {
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
      headers.set(
        "content-disposition",
        `filename="${filename}"; filename*=UTF-8''${filename}`,
      );
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

function nullBody(
  method: string,
  status: number | undefined,
): boolean | 0 | undefined {
  // prettier-ignore
  return (method === "HEAD" ||
    status === 100 || status === 101 || status === 102 ||
    status === 204 || status === 205 || status === 304
  )
}

function errorResponse(error: HTTPError, debug?: boolean): Response {
  return new FastResponse(
    JSON.stringify(
      {
        ...error.toJSON(),
        stack:
          debug && error.stack
            ? error.stack.split("\n").map((l) => l.trim())
            : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    {
      status: error.status,
      statusText: error.statusText,
      headers: error.headers
        ? mergeHeaders(jsonHeaders, error.headers)
        : jsonHeaders,
    },
  );
}
