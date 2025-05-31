import type { EventHandler, H3Event } from "../types";
import { defineEventHandler } from "../handler";

const authenticationFailed = (event: H3Event) => {
  event.response.headers.set(
    "WWW-Authenticate",
    'Basic realm="Authentication required"',
  );
  event.response.status = 401;
  return "Authentication required";
};

/**
 * Protect an event handler with basic authentication
 *
 * @example
 * export default withBasicAuth({ username: 'test', password: 'abc123!' }, defineEventHandler(async (event) => {
 *   return 'Hello, world!';
 * }));
 *
 * @param auth The username and password to use for authentication.
 * @param handler The event handler to wrap.
 */
export function withBasicAuth(
  auth: { username: string; password: string } | string,
  handler: EventHandler,
): EventHandler {
  const authString =
    typeof auth === "string" ? auth : `${auth.username}:${auth.password}`;
  return defineEventHandler(async (event) => {
    const authHeader = event.request.headers.get("authorization");

    if (!authHeader) {
      return authenticationFailed(event);
    }

    const b64auth = authHeader.split(" ")[1] || "";
    const decodedAuthHeader = Buffer.from(b64auth, "base64").toString();

    if (decodedAuthHeader !== authString) {
      return authenticationFailed(event);
    }

    return await handler(event);
  });
}
