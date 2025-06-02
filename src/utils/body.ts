import type { H3Event } from "../types/event.ts";
import type { InferEventInput } from "../types/handler.ts";
import { createError } from "../error.ts";
import { validateData, type ValidateFunction } from "./internal/validate.ts";
import { parseURLEncodedBody } from "./internal/body.ts";

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
    throw createError({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "Invalid JSON body",
    });
  }
}

/**
 * Tries to read the request body via `readBody`, then uses the provided validation function and either throws a validation error or returns the result.
 *
 * You can use a simple function to validate the body or use a library like `zod` to define a schema.
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
 *   const objectSchema = z.object();
 *   const body = await readValidatedBody(event, objectSchema.safeParse);
 * });
 *
 * @param event The H3Event passed by the handler.
 * @param validate The function to use for body validation. It will be called passing the read request body. If the result is not false, the parsed body will be returned.
 * @throws If the validation function returns `false` or throws, a validation error will be thrown.
 * @return {*} The `Object`, `Array`, `String`, `Number`, `Boolean`, or `null` value corresponding to the request JSON body.
 * @see {readBody}
 */
export async function readValidatedBody<
  T,
  Event extends H3Event = H3Event,
  _T = InferEventInput<"body", Event, T>,
>(event: Event, validate: ValidateFunction<_T>): Promise<_T> {
  const _body = await readBody(event);
  return validateData(_body, validate);
}
