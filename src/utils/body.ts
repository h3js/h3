import { HTTPError } from "../error.ts";
import { validateData } from "./internal/validate.ts";
import { parseURLEncodedBody } from "./internal/body.ts";

import type { H3Event } from "../types/event.ts";
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
  _Event extends H3Event = H3Event,
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
  Event extends H3Event,
  S extends StandardSchemaV1,
>(event: Event, validate: S): Promise<InferOutput<S>>;
export async function readValidatedBody<
  Event extends H3Event,
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
 * app.get("/", async (event) => {
 *   const body = await readValidatedBody(event, (body) => {
 *     return typeof body === "object" && body !== null;
 *   });
 * });
 * @example
 * import { z } from "zod";
 *
 * app.get("/", async (event) => {
 *   const objectSchema = z.object({
 *     name: z.string().min(3).max(20),
 *     age: z.number({ coerce: true }).positive().int(),
 *   });
 *   const body = await readValidatedBody(event, objectSchema);
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param validate The function to use for body validation. It will be called passing the read request body. If the result is not false, the parsed body will be returned.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request JSON body.
 * @see {readBody}
 */
export async function readValidatedBody(
  event: H3Event,
  validate: any,
): Promise<any> {
  const _body = await readBody(event);
  return validateData(_body, validate);
}
