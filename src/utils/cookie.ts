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

interface SetCookieState {
  cookies: string[];
  keys: Array<string | undefined>;
  distinctKeys: Set<string>;
}

const requestCookiesCache = new WeakMap<
  Headers,
  { source: string; cookies: Record<string, string | undefined> }
>();
const responseCookiesCache = new WeakMap<Headers, SetCookieState>();

/**
 * Parse the request to get HTTP Cookie header string and returning an object of all cookie name-value pairs.
 * @param event {HTTPEvent} H3 event or req passed by h3 handler
 * @returns Object of cookie name-value pairs
 * ```ts
 * const cookies = parseCookies(event)
 * ```
 */
export function parseCookies(event: HTTPEvent): Record<string, string | undefined> {
  const headers = event.req.headers;
  const source = headers.get("cookie") || "";
  const cached = requestCookiesCache.get(headers);
  if (cached && cached.source === source) {
    return cached.cookies;
  }

  const cookies = parseCookie(source);
  requestCookiesCache.set(headers, { source, cookies });
  return cookies;
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
  const { encode, stringify, ...attrs } = options ?? {};
  const newCookie = serializeCookie({ name, value, path: "/", ...attrs }, { encode, stringify });

  // Merge and deduplicate unique set-cookie headers
  const headers = event.res.headers;
  const state = _getSetCookieState(headers);
  const newCookieKey = _getDistinctCookieKey(name, options || {});
  if (!state.distinctKeys.has(newCookieKey)) {
    state.cookies.push(newCookie);
    state.keys.push(newCookieKey);
    state.distinctKeys.add(newCookieKey);
    if (state.cookies.length === 1) {
      headers.set("set-cookie", newCookie);
    } else {
      headers.append("set-cookie", newCookie);
    }
    return;
  }

  const dedupedCookies = [];
  const dedupedKeys = [];
  for (const [index, cookie] of state.cookies.entries()) {
    if (state.keys[index] === newCookieKey) {
      continue;
    }
    dedupedCookies.push(cookie);
    dedupedKeys.push(state.keys[index]);
  }
  dedupedCookies.push(newCookie);
  dedupedKeys.push(newCookieKey);

  _writeSetCookieState(headers, state, dedupedCookies, dedupedKeys);
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
  const cookies = parseCookies(event);
  const mainCookie = cookies[name];
  if (!mainCookie || !mainCookie.startsWith(CHUNKED_COOKIE)) {
    return mainCookie;
  }

  const chunksCount = getChunkedCookieCount(mainCookie);
  if (chunksCount === 0) {
    return undefined;
  }

  const chunks = [];
  for (let i = 1; i <= chunksCount; i++) {
    const chunk = cookies[chunkCookieName(name, i)];
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

function _getSetCookieState(headers: Headers): SetCookieState {
  let state = responseCookiesCache.get(headers);
  if (state) {
    return state;
  }

  state = {
    cookies: [],
    keys: [],
    distinctKeys: new Set(),
  };
  responseCookiesCache.set(headers, state);

  if (!headers.has("set-cookie")) {
    return state;
  }

  for (const cookie of headers.getSetCookie()) {
    state.cookies.push(cookie);
    const parsed = parseSetCookie(cookie);
    const key = parsed ? _getDistinctCookieKey(parsed.name, parsed) : undefined;
    state.keys.push(key);
    if (key) {
      state.distinctKeys.add(key);
    }
  }

  return state;
}

function _writeSetCookieState(
  headers: Headers,
  state: SetCookieState,
  cookies: string[],
  keys: Array<string | undefined>,
): void {
  headers.delete("set-cookie");
  const distinctKeys = new Set<string>();
  for (const [index, cookie] of cookies.entries()) {
    headers.append("set-cookie", cookie);
    const key = keys[index];
    if (key) {
      distinctKeys.add(key);
    }
  }
  state.cookies = cookies;
  state.keys = keys;
  state.distinctKeys = distinctKeys;
}
