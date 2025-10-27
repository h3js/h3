import { HTTPError } from "../error.ts";
import { validateData } from "./internal/validate.ts";
import { parseURLEncodedBody } from "./internal/body.ts";

import type { HTTPEvent } from "../event.ts";
import type { InferEventInput } from "../types/handler.ts";
import type { ValidateResult } from "./internal/validate.ts";
import type {
  StandardSchemaV1,
  InferOutput,
} from "./internal/standard-schema.ts";

/**
 * Reads request body and tries to parse using JSON.parse or URLSearchParams.
 *
 * @example
 * app.get("/", async (event) => {
 *   const body = await readBody(event);
 * });
 *
 * @param event H3 event passed by h3 handler
 * @param encoding The character encoding to use, defaults to 'utf-8'.
 *
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request JSON body
 */
export async function readBody<
  T,
  _Event extends HTTPEvent = HTTPEvent,
  _T = InferEventInput<"body", _Event, T>,
>(event: _Event): Promise<undefined | _T> {
  const text = await event.req.text();
  if (!text) {
    return undefined;
  }

  const contentType = event.req.headers.get("content-type") || "";
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    return parseURLEncodedBody(text) as _T;
  }

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

export async function readValidatedBody<
  Event extends HTTPEvent,
  S extends StandardSchemaV1,
>(event: Event, validate: S): Promise<InferOutput<S>>;
export async function readValidatedBody<
  Event extends HTTPEvent,
  OutputT,
  InputT = InferEventInput<"body", Event, OutputT>,
>(
  event: Event,
  validate: (
    data: InputT,
  ) => ValidateResult<OutputT> | Promise<ValidateResult<OutputT>>,
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
 * app.get("/", async (event) => {
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
 * app.get("/", async (event) => {
 *   const body = await readValidatedBody(event, objectSchema);
 * });
 *
 * @param event The HTTPEvent passed by the handler.
 * @param validate The function to use for body validation. It will be called passing the read request body. If the result is not false, the parsed body will be returned.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request JSON body.
 * @see {readBody}
 */
export async function readValidatedBody(
  event: HTTPEvent,
  validate: any,
): Promise<any> {
  const _body = await readBody(event);
  return validateData(_body, validate);
}

/**
 * Asserts that request body size is within the specified limit.
 *
 * If body size exceeds the limit, throws a `413` Request Entity Too Large response error.
 *
 * @example
 * app.get("/", async (event) => {
 *   await assertBodySize(event, 10 * 1024 * 1024); // 10MB
 *   const data = await event.req.formData();
 * });
 *
 * @param event HTTP event
 * @param limit Body size limit in bytes
 */
export async function assertBodySize(
  event: HTTPEvent,
  limit: number,
): Promise<void> {
  const isWithin = await isBodySizeWithin(event, limit);
  if (!isWithin) {
    throw new HTTPError({
      status: 413,
      statusText: "Request Entity Too Large",
      message: `Request body size exceeds the limit of ${limit} bytes`,
    });
  }
}

// Internal util for now. We can export later if needed
async function isBodySizeWithin(
  event: HTTPEvent,
  limit: number,
): Promise<boolean> {
  const req = event.req;
  if (req.body === null) {
    return true;
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const transferEncoding = req.headers.get("transfer-encoding");
    if (transferEncoding) {
      // https://datatracker.ietf.org/doc/html/rfc7230#section-3.3.2
      throw new HTTPError({ status: 400 });
    }
    return +contentLength <= limit;
  }

  const reader = req.clone().body!.getReader();
  let chunk = await reader.read();
  let size = 0;
  while (!chunk.done) {
    size += chunk.value.byteLength;
    if (size > limit) {
      return false;
    }
    chunk = await reader.read();
  }

  return true;
}
