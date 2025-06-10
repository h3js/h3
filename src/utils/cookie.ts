import type { CookieSerializeOptions, SetCookie } from "cookie-es";
import type { H3Event } from "../types/event.ts";
import {
  parse as parseCookie,
  serialize as serializeCookie,
  parseSetCookie,
} from "cookie-es";

const CHUNKS_PREFIX = "chunks:";

// The limit is approximately 4KB, but may vary by browser and server. We leave some room to be safe.
const CHUNKS_MAX_LENGTH = 4050;

/**
 * Parse the request to get HTTP Cookie header string and returning an object of all cookie name-value pairs.
 * @param event {H3Event} H3 event or req passed by h3 handler
 * @returns Object of cookie name-value pairs
 * ```ts
 * const cookies = parseCookies(event)
 * ```
 */
export function parseCookies(event: H3Event): Record<string, string> {
  return parseCookie(event.req.headers.get("cookie") || "");
}

/**
 * Get a cookie value by name.
 * @param event {H3Event} H3 event or req passed by h3 handler
 * @param name Name of the cookie to get
 * @returns {*} Value of the cookie (String or undefined)
 * ```ts
 * const authorization = getCookie(request, 'Authorization')
 * ```
 */
export function getCookie(event: H3Event, name: string): string | undefined {
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
  const newCookie = serializeCookie(name, value, { path: "/", ...options });

  // Check and add only not any other set-cookie headers already set
  const currentCookies = event.res.headers.getSetCookie();
  if (currentCookies.length === 0) {
    event.res.headers.set("set-cookie", newCookie);
    return;
  }

  // Merge and deduplicate unique set-cookie headers
  const newCookieKey = _getDistinctCookieKey(
    name,
    (options || {}) as SetCookie,
  );
  event.res.headers.delete("set-cookie");
  for (const cookie of currentCookies) {
    const _key = _getDistinctCookieKey(
      cookie.split("=")?.[0],
      parseSetCookie(cookie),
    );
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
 * @param event {H3Event} H3 event or req passed by h3 handler
 * @param name Name of the cookie to get
 * @returns {*} Value of the cookie (String or undefined)
 * ```ts
 * const authorization = getCookie(request, 'Session')
 * ```
 */
export function getChunkedCookie(event: H3Event, name: string): string | undefined {
  const mainCookie = getCookie(event, name);
  if (!mainCookie || !mainCookie.startsWith(CHUNKS_PREFIX)) {
    return mainCookie;
  }

  // TODO extract into function
  const chunksCount = Number.parseInt(mainCookie.split(":")[1], 10);
  if (Number.isNaN(chunksCount) || chunksCount <= 0) {
    return undefined;
  }

  const chunkCookies = [];
  for (let i = 1; i <= chunksCount; i++) {
    const chunk = getCookie(event, `${name}.C${i}`);
    if (!chunk) {
      return undefined;
    }
    chunkCookies.push(chunk);
  }

  return chunkCookies.join("");
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
  options?: CookieSerializeOptions,
): void {
  const chunkCount = Math.ceil(value.length / CHUNKS_MAX_LENGTH);
  if (chunkCount <= 1) {
    // If the value is small enough, just set it as a normal cookie
    setCookie(event, name, value, options);
    return;
  }

  // If the value is too large, we need to chunk it
  const mainCookieValue = `${CHUNKS_PREFIX}${chunkCount}`;
  setCookie(event, name, mainCookieValue, options);

  // TODO split value into chunks
  // TODO set cookie per chunk
  // TODO set main cookie to store how many chunks

  // TODO also delete any prior chunks if the cookie is updated
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
  // TODO get first cookie
  // TOOD read how many chunks
  // TODO remove all the chunk cookies
  // TODO remove original cookie
}

/**
 * Cookies are unique by "cookie-name, domain-value, and path-value".
 *
 * @see https://httpwg.org/specs/rfc6265.html#rfc.section.4.1.2
 */
function _getDistinctCookieKey(name: string, options: Partial<SetCookie>) {
  return [name, options.domain || "", options.path || "/"].join(";");
}
