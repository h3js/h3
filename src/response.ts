import { FastResponse } from "srvx";
import { HTTPError } from "./error.ts";
import { isJSONSerializable } from "./utils/internal/object.ts";

import type { H3Config } from "./types/h3.ts";
import type { H3Event } from "./types/event.ts";

export const kNotFound: symbol = /* @__PURE__ */ Symbol.for("h3.notFound");
export const kHandled: symbol = /* @__PURE__ */ Symbol.for("h3.handled");

export function handleResponse(
  val: unknown,
  event: H3Event,
  config: H3Config = {},
): Response | Promise<Response> {
  if (val && val instanceof Promise) {
    return val
      .catch((error) => error)
      .then((resolvedVal) => handleResponse(resolvedVal, event, config));
  }

  const response = prepareResponse(val, event, config);
  if (response instanceof Promise) {
    return handleResponse(response, event, config);
  }

  const { onBeforeResponse } = config;
  return onBeforeResponse
    ? Promise.resolve(onBeforeResponse(event, response)).then(() => response)
    : response;
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
    }
    const { onError } = config;
    return onError && !nested
      ? Promise.resolve(onError(error, event))
          .catch((error) => error)
          .then((newVal) => prepareResponse(newVal ?? val, event, config, true))
      : errorResponse(error, config.debug);
  }

  // Only set if event.res.headers is accessed
  const eventHeaders = (event.res as { _headers?: Headers })._headers;

  if (!(val instanceof Response)) {
    const res = prepareResponseBody(val, event, config);
    const status = event.res.status;
    return new FastResponse(
      nullBody(event.req.method, status) ? null : res.body,
      {
        status,
        statusText: event.res.statusText,
        headers:
          res.headers && eventHeaders
            ? mergeHeaders(res.headers, eventHeaders)
            : res.headers || eventHeaders,
      },
    );
  }

  // Note: Only check _headers. res.status/statusText are not used as we use them from the response
  if (!eventHeaders) {
    return val; // Fast path: no headers to merge
  }
  return new FastResponse(
    nullBody(event.req.method, val.status) ? null : val.body,
    {
      status: val.status,
      statusText: val.statusText,
      headers: mergeHeaders(eventHeaders, val.headers),
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
): { body: BodyInit; headers?: HeadersInit } {
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
    return { body: val };
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
    const headers: Record<string, string> = {
      "content-type": val.type,
      "content-length": val.size.toString(),
    };

    // File
    if ("name" in val) {
      const filename = encodeURIComponent(val.name as string);
      // Omit the disposition type ("inline" or "attachment") and let the client (browser) decide.
      headers["content-disposition"] =
        `filename="${filename}"; filename*=UTF-8''${filename}`;
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
  const isSensitive = !debug && error.unhandled;
  return new FastResponse(
    JSON.stringify(
      {
        status: error.status,
        statusText: isSensitive ? undefined : error.statusText || undefined,
        message: isSensitive ? undefined : error.message,
        data: isSensitive ? undefined : error.data,
        stack:
          debug && error.stack
            ? error.stack.split("\n").map((l) => l.trim())
            : undefined,
      },
      null,
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
