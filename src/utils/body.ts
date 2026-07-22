import { limitBodyStream } from "srvx/body-limit";

import { type ErrorDetails, HTTPError } from "../error.ts";
import { type OnValidateError, validateData } from "./internal/validate.ts";
import { parseURLEncodedBody, parseFormData } from "./internal/body.ts";

import type { ServerRequest } from "srvx";
import type { HTTPEvent } from "../event.ts";
import type { InferEventInput } from "../types/handler.ts";
import type { ValidateResult } from "./internal/validate.ts";
import type { StandardSchemaV1, FailureResult, InferOutput } from "./internal/standard-schema.ts";

export interface ReadBodyOptions {
  /**
   * Force a parser instead of inferring it from the request `Content-Type`.
   *
   * - `"json"` (default): parse as JSON.
   * - `"text"`: return the raw string body.
   * - `"urlencoded"`: parse as `application/x-www-form-urlencoded`.
   * - `"formData"`: parse as `multipart/form-data` (or url-encoded) form data.
   */
  type?: "json" | "text" | "urlencoded" | "formData";
}

/**
 * Reads request body and tries to parse using JSON.parse or URLSearchParams.
 *
 * By default the body is parsed as JSON (falling back to URL-encoded parsing
 * when the `Content-Type` is `application/x-www-form-urlencoded`). Other body
 * types, such as `multipart/form-data`, must be opted into explicitly via
 * `options.type` and are never auto-detected from the request headers.
 *
 * @example
 * app.post("/", async (event) => {
 *   const body = await readBody(event);
 * });
 * @example
 * app.post("/upload", async (event) => {
 *   const body = await readBody(event, { type: "formData" });
 * });
 *
 * @param event H3 event passed by h3 handler
 * @param options Parsing options. Set `type` to force a parser instead of
 *   inferring it from the request `Content-Type`.
 *
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request body
 */
export async function readBody<
  T,
  _Event extends HTTPEvent = HTTPEvent,
  _T = InferEventInput<"body", _Event, T>,
>(event: _Event, options?: ReadBodyOptions): Promise<undefined | _T> {
  const contentType = event.req.headers.get("content-type") || "";
  const type = options?.type;

  // `formData` (multipart or url-encoded) is strictly opt-in: unlike JSON it
  // is never auto-detected from the `Content-Type` header, so an untrusted
  // request cannot push readBody into (potentially expensive) multipart
  // parsing without the handler explicitly asking for it. See #875.
  if (type === "formData") {
    let form: FormData;
    try {
      form = await event.req.formData();
    } catch (error) {
      // A body-size overflow surfaces here when the limited stream aborts
      // mid-read; propagate it as-is so it maps to `413` rather than a generic
      // `400 Invalid form data body`. See `assertBodySize`.
      if (isBodyLimitError(error)) {
        throw error;
      }
      throw new HTTPError({
        status: 400,
        statusText: "Bad Request",
        message: "Invalid form data body",
      });
    }
    return parseFormData(form) as _T;
  }

  const text = await event.req.text();

  // Text is returned verbatim, including an empty body as `""`.
  if (type === "text") {
    return text as _T;
  }

  if (!text) {
    return undefined;
  }

  if (
    type === "urlencoded" ||
    (!type && contentType.startsWith("application/x-www-form-urlencoded"))
  ) {
    return parseURLEncodedBody(text) as _T;
  }

  // Default, and explicit `type: "json"`.
  try {
    return JSON.parse(text) as _T;
  } catch {
    throw new HTTPError({
      status: 400,
      statusText: "Bad Request",
      message: "Invalid JSON body",
    });
  }
}

export async function readValidatedBody<Event extends HTTPEvent, S extends StandardSchemaV1>(
  event: Event,
  validate: S,
  options?: ReadBodyOptions & { onError?: (result: FailureResult) => ErrorDetails },
): Promise<InferOutput<S>>;
export async function readValidatedBody<
  Event extends HTTPEvent,
  OutputT,
  InputT = InferEventInput<"body", Event, OutputT>,
>(
  event: Event,
  validate: (data: InputT) => ValidateResult<OutputT> | Promise<ValidateResult<OutputT>>,
  options?: ReadBodyOptions & {
    onError?: () => ErrorDetails;
  },
): Promise<OutputT>;
/**
 * Tries to read the request body via `readBody`, then uses the provided validation schema or function and either throws a validation error or returns the result.
 *
 * You can use a simple function to validate the body or use a Standard-Schema compatible library like `zod` to define a schema.
 *
 * @example
 * function validateBody(body: any) {
 *   return typeof body === "object" && body !== null;
 * }
 *
 * app.post("/", async (event) => {
 *   const body = await readValidatedBody(event, validateBody);
 * });
 * @example
 * import { z } from "zod";
 *
 * const objectSchema = z.object({
 *   name: z.string().min(3).max(20),
 *   age: z.number({ coerce: true }).positive().int(),
 * });
 *
 * app.post("/", async (event) => {
 *   const body = await readValidatedBody(event, objectSchema);
 * });
 * @example
 * import * as v from "valibot";
 *
 * app.post("/", async (event) => {
 *   const body = await readValidatedBody(
 *     event,
 *     v.object({
 *       name: v.pipe(v.string(), v.minLength(3), v.maxLength(20)),
 *       age: v.pipe(v.number(), v.integer(), v.minValue(1)),
 *     }),
 *     {
 *       onError: ({ issues }) => ({
 *         statusText: "Custom validation error",
 *         message: v.summarize(issues),
 *       }),
 *     },
 *   );
 * });
 *
 * @param event The HTTPEvent passed by the handler.
 * @param validate The function to use for body validation. It will be called passing the read request body. If the result is not false, the parsed body will be returned.
 * @param options Optional options. If provided, the `onError` function will be called with the validation issues if validation fails.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request JSON body.
 * @see {readBody}
 */
export async function readValidatedBody(
  event: HTTPEvent,
  validate: any,
  options?: ReadBodyOptions & {
    onError?: OnValidateError;
  },
): Promise<any> {
  const _body = await readBody(event, options);
  return validateData(_body, validate, options);
}

/**
 * Asserts that the request body size is within the specified limit.
 *
 * The limit is enforced **as the body is read**, not by pre-buffering: the
 * request body stream is wrapped in a byte counter (via {@link limitBodyStream})
 * that aborts with a `413` Request Entity Too Large error the moment the running
 * total exceeds `limit`. This preserves the byte-accurate guarantee (a
 * lying-small `Content-Length` is still caught mid-stream) without holding the
 * body in memory or blocking streaming handlers.
 *
 * An honest `Content-Length` that already exceeds the limit is rejected up-front
 * with a `413`, and a request carrying both `Content-Length` and
 * `Transfer-Encoding` is rejected with a `400` (request smuggling, RFC 7230).
 *
 * Because enforcement is tied to consumption, an overflow on a chunked /
 * unknown-length body surfaces when the handler reads the body rather than as a
 * pre-handler `413`, and a body the handler never reads is never counted.
 *
 * @example
 * app.post("/", async (event) => {
 *   assertBodySize(event, 10 * 1024 * 1024); // 10MB
 *   const data = await event.req.formData();
 * });
 *
 * @param event HTTP event
 * @param limit Body size limit in bytes
 */
export function assertBodySize(event: HTTPEvent, limit: number): void {
  const req = event.req;
  if (!req.body) {
    return;
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    // A message carrying both `Content-Length` and `Transfer-Encoding` is a
    // request smuggling vector and must be rejected.
    // https://datatracker.ietf.org/doc/html/rfc7230#section-3.3.2
    if (req.headers.get("transfer-encoding")) {
      throw new HTTPError({ status: 400 });
    }
    // Fail-fast: reject an honest oversized `Content-Length` before the handler
    // runs, without touching the body stream.
    if (+contentLength > limit) {
      throw new HTTPError({
        status: 413,
        statusText: "Request Entity Too Large",
        message: `Request body size exceeds the limit of ${limit} bytes`,
      });
    }
  }

  // Wrap the body in a byte-counting stream that enforces the limit as it flows.
  const limited = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: limitBodyStream(req.body, limit),
    // @ts-expect-error `duplex` is required for a streaming request body.
    duplex: "half",
    signal: req.signal,
  }) as ServerRequest;
  // Rebuilding the `Request` drops srvx's runtime augmentation; carry it over so
  // `event.runtime`, `getRequestIP`, `waitUntil`, etc. keep working (mirrors
  // `createSubRequest` in `proxy.ts`).
  limited.runtime = req.runtime;
  limited.waitUntil = req.waitUntil;
  limited.ip = req.ip;
  limited.context = req.context;
  (event as { req: ServerRequest }).req = limited;
}

/** Whether an error was thrown by the srvx body-size limiter. */
function isBodyLimitError(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "ERR_BODY_TOO_LARGE";
}
