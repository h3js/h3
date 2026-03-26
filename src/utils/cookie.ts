import type { CookieSerializeOptions } from "cookie-es";
import type { H3Event, HTTPEvent } from "../event.ts";
import { parseCookie, serializeCookie, parseSetCookie } from "cookie-es";
import { validateData } from "./internal/validate.ts";
import type { StandardSchemaV1, FailureResult, InferOutput } from "./internal/standard-schema.ts";
import type { ValidateResult, OnValidateError } from "./internal/validate.ts";
import type { ErrorDetails } from "../error.ts";

const CHUNKED_COOKIE = "__chunked__";

// The limit is approximately 4KB, but may vary by browser and server. We leave some room to be safe.
const CHUNKS_MAX_LENGTH = 4000;

/**
 * Parse the request to get HTTP Cookie header string and returning an object of all cookie name-value pairs.
 * @param event {HTTPEvent} H3 event or req passed by h3 handler
 * @returns Object of cookie name-value pairs
 * ```ts
 * const cookies = parseCookies(event)
 * ```
 */
export function parseCookies(event: HTTPEvent): Record<string, string | undefined> {
  return parseCookie(event.req.headers.get("cookie") || "");
}

/**
 * Get and validate all cookies using a Standard Schema or custom validator.
 *
 * @example
 * app.get("/", async (event) => {
 *   const cookies = await getValidatedCookies(event, z.object({
 *     session: z.string(),
 *     theme: z.enum(["light", "dark"]).optional(),
 *   }));
 * });
 */
export function getValidatedCookies<Event extends HTTPEvent, S extends StandardSchemaV1<any, any>>(
  event: Event,
  validate: S,
  options?: { onError?: (result: FailureResult) => ErrorDetails },
): Promise<InferOutput<S>>;
export function getValidatedCookies<Event extends HTTPEvent, OutputT>(
  event: Event,
  validate: (
    data: Record<string, string | undefined>,
  ) => ValidateResult<OutputT> | Promise<ValidateResult<OutputT>>,
  options?: { onError?: () => ErrorDetails },
): Promise<OutputT>;
export function getValidatedCookies(
  event: HTTPEvent,
  validate: any,
  options?: { onError?: OnValidateError },
): Promise<any> {
  const cookies = parseCookies(event);
  return validateData(cookies, validate, options);
}

/**
 * Get a cookie value by name.
 * @param event {HTTPEvent} H3 event or req passed by h3 handler
 * @param name Name of the cookie to get
 * @returns {*} Value of the cookie (String or undefined)
 * ```ts
 * const authorization = getCookie(request, 'Authorization')
 * ```
 */
export function getCookie(event: HTTPEvent, name: string): string | undefined {
  return parseCookies(event)[name];
}

/**
 * Set a cookie value by name.
 * @param event {H3Event} H3 event or res passed by h3 handler
 * @param name Name of the cookie to set
 * @param value Value of the cookie to set
 * @param options {CookieSerializeOptions} Options for serializing the cookie
 * ```ts
 * setCookie(res, 'Authorization', '1234567')
 * ```
 */
export function setCookie(
  event: H3Event,
  name: string,
  value: string,
  options?: CookieSerializeOptions,
): void {
  // Serialize cookie
  const newCookie = serializeCookie({ name, value, path: "/", ...options });

  // Check and add only not any other set-cookie headers already set
  const currentCookies = event.res.headers.getSetCookie();
  if (currentCookies.length === 0) {
    event.res.headers.set("set-cookie", newCookie);
    return;
  }

  // Merge and deduplicate unique set-cookie headers
  const newCookieKey = _getDistinctCookieKey(name, options || {});
  event.res.headers.delete("set-cookie");
  for (const cookie of currentCookies) {
    const parsed = parseSetCookie(cookie);
    if (!parsed) {
      continue;
    }
    const _key = _getDistinctCookieKey(cookie.split("=")?.[0], parsed);
    if (_key === newCookieKey) {
      continue;
    }
    event.res.headers.append("set-cookie", cookie);
  }
  event.res.headers.append("set-cookie", newCookie);
}

/**
 * Remove a cookie by name.
 * @param event {H3Event} H3 event or res passed by h3 handler
 * @param name Name of the cookie to delete
 * @param serializeOptions {CookieSerializeOptions} Cookie options
 * ```ts
 * deleteCookie(res, 'SessionId')
 * ```
 */
export function deleteCookie(
  event: H3Event,
  name: string,
  serializeOptions?: CookieSerializeOptions,
): void {
  setCookie(event, name, "", {
    ...serializeOptions,
    maxAge: 0,
  });
}

/**
 * Get a chunked cookie value by name. Will join chunks together.
 * @param event {HTTPEvent} { req: Request }
 * @param name Name of the cookie to get
 * @returns {*} Value of the cookie (String or undefined)
 * ```ts
 * const session = getChunkedCookie(event, 'Session')
 * ```
 */
export function getChunkedCookie(event: HTTPEvent, name: string): string | undefined {
  const mainCookie = getCookie(event, name);
  if (!mainCookie || !mainCookie.startsWith(CHUNKED_COOKIE)) {
    return mainCookie;
  }

  const chunksCount = getChunkedCookieCount(mainCookie);
  if (chunksCount === 0) {
    return undefined;
  }

  const chunks = [];
  for (let i = 1; i <= chunksCount; i++) {
    const chunk = getCookie(event, chunkCookieName(name, i));
    if (!chunk) {
      return undefined;
    }
    chunks.push(chunk);
  }

  return chunks.join("");
}

/**
 * Set a cookie value by name. Chunked cookies will be created as needed.
 * @param event {H3Event} H3 event or res passed by h3 handler
 * @param name Name of the cookie to set
 * @param value Value of the cookie to set
 * @param options {CookieSerializeOptions} Options for serializing the cookie
 * ```ts
 * setCookie(res, 'Session', '<session data>')
 * ```
 */
export function setChunkedCookie(
  event: H3Event,
  name: string,
  value: string,
  options?: CookieSerializeOptions & { chunkMaxLength?: number },
): void {
  const chunkMaxLength = options?.chunkMaxLength || CHUNKS_MAX_LENGTH;
  const chunkCount = Math.ceil(value.length / chunkMaxLength);

  // delete any prior left over chunks if the cookie is updated
  const previousCookie = getCookie(event, name);
  if (previousCookie?.startsWith(CHUNKED_COOKIE)) {
    const previousChunkCount = getChunkedCookieCount(previousCookie);
    if (previousChunkCount > chunkCount) {
      for (let i = chunkCount; i <= previousChunkCount; i++) {
        deleteCookie(event, chunkCookieName(name, i), options);
      }
    }
  }

  if (chunkCount <= 1) {
    // If the value is small enough, just set it as a normal cookie
    setCookie(event, name, value, options);
    return;
  }

  // If the value is too large, we need to chunk it
  const mainCookieValue = `${CHUNKED_COOKIE}${chunkCount}`;
  setCookie(event, name, mainCookieValue, options);

  for (let i = 1; i <= chunkCount; i++) {
    const start = (i - 1) * chunkMaxLength;
    const end = start + chunkMaxLength;
    const chunkValue = value.slice(start, end);
    setCookie(event, chunkCookieName(name, i), chunkValue, options);
  }
}

/**
 * Remove a set of chunked cookies by name.
 * @param event {H3Event} H3 event or res passed by h3 handler
 * @param name Name of the cookie to delete
 * @param serializeOptions {CookieSerializeOptions} Cookie options
 * ```ts
 * deleteCookie(res, 'Session')
 * ```
 */
export function deleteChunkedCookie(
  event: H3Event,
  name: string,
  serializeOptions?: CookieSerializeOptions,
): void {
  const mainCookie = getCookie(event, name);
  deleteCookie(event, name, serializeOptions);

  const chunksCount = getChunkedCookieCount(mainCookie);
  if (chunksCount >= 0) {
    for (let i = 0; i < chunksCount; i++) {
      deleteCookie(event, chunkCookieName(name, i + 1), serializeOptions);
    }
  }
}

/**
 * Cookies are unique by "cookie-name, domain-value, and path-value".
 *
 * @see https://httpwg.org/specs/rfc6265.html#rfc.section.4.1.2
 */
function _getDistinctCookieKey(name: string, options: { domain?: string; path?: string }) {
  return [name, options.domain || "", options.path || "/"].join(";");
}

// Maximum number of chunks allowed for chunked cookies.
// 100 chunks × ~4KB = ~400KB, far beyond any practical cookie size.
const MAX_CHUNKED_COOKIE_COUNT = 100;

function getChunkedCookieCount(cookie: string | undefined): number {
  if (!cookie?.startsWith(CHUNKED_COOKIE)) {
    return Number.NaN;
  }
  const count = Number.parseInt(cookie.slice(CHUNKED_COOKIE.length));
  if (Number.isNaN(count) || count < 0 || count > MAX_CHUNKED_COOKIE_COUNT) {
    return Number.NaN;
  }
  return count;
}

function chunkCookieName(name: string, chunkNumber: number): string {
  return `${name}.${chunkNumber}`;
}
