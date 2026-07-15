import { getEventContext, HTTPError } from "../index.ts";

import type { H3EventContext, HTTPEvent, Middleware } from "../index.ts";
import { randomJitter, timingSafeEqual } from "./internal/auth.ts";

type _BasicAuthOptions = {
  /**
   * Validate username for basic auth.
   */
  username: string;

  /***
   * Simple password for basic auth.
   */
  password: string;

  /**
   * Custom validation function for basic auth.
   *
   * When provided, the built-in non-empty check is skipped and this function
   * receives the decoded `username`/`password` as-is, including empty strings
   * (RFC 7617 permits an empty user-id and/or password). It must return `false`
   * to reject empty or otherwise invalid credentials.
   */
  validate: (username: string, password: string) => boolean | Promise<boolean>;

  /**
   * Realm for the basic auth challenge.
   *
   * Defaults to "auth".
   */
  realm: string;
};

export type BasicAuthOptions = Partial<_BasicAuthOptions> &
  ({ validate: _BasicAuthOptions["validate"] } | { password: _BasicAuthOptions["password"] });

/**
 * Apply basic authentication for current request.
 *
 * @example
 * import { defineHandler, requireBasicAuth } from "h3";
 * export default defineHandler(async (event) => {
 *   await requireBasicAuth(event, { password: "test" });
 *   return `Hello, ${event.context.basicAuth.username}!`;
 * });
 */
export async function requireBasicAuth(event: HTTPEvent, opts: BasicAuthOptions): Promise<true> {
  if (!opts.validate && !opts.password) {
    throw new HTTPError({
      message: "Either 'password' or 'validate' option must be provided",
      status: 500,
    });
  }

  const realm = opts?.realm ?? "auth";

  const authHeader = event.req.headers.get("authorization");
  if (!authHeader) {
    throw await authFailed(event, realm);
  }
  // RFC 9110: credentials = auth-scheme [ 1*SP token68 ]; allow one or more spaces.
  const b64auth = /^basic +(.+)$/i.exec(authHeader)?.[1];
  if (!b64auth) {
    throw await authFailed(event, realm);
  }
  let authDecoded: string;
  try {
    authDecoded = atob(b64auth);
  } catch {
    throw await authFailed(event, realm);
  }
  const colonIndex = authDecoded.indexOf(":");
  if (colonIndex === -1) {
    // RFC 7617: credentials must be "user-id ":" password"; reject if missing.
    throw await authFailed(event, realm);
  }
  const username = authDecoded.slice(0, colonIndex);
  const password = authDecoded.slice(colonIndex + 1);
  // RFC 7617 allows empty user-id/password; only enforce non-empty when no
  // custom validate function is provided (i.e. plain username/password check).
  if (!opts.validate && (!username || !password)) {
    throw await authFailed(event, realm);
  }

  // Evaluate all comparisons unconditionally so failure timing does not
  // distinguish an unknown user from a wrong password.
  const usernameOk = !opts.username || timingSafeEqual(username, opts.username);
  const passwordOk = !opts.password || timingSafeEqual(password, opts.password);
  const validateOk = !opts.validate || (await opts.validate(username, password));
  if (!usernameOk || !passwordOk || !validateOk) {
    throw await authFailed(event, realm);
  }

  const context = getEventContext<H3EventContext>(event);
  context.basicAuth = { username, password, realm };

  return true;
}

/**
 * Create a basic authentication middleware.
 *
 * @example
 * import { H3, serve, basicAuth } from "h3";
 * const auth = basicAuth({ password: "test" });
 * app.get("/", (event) => `Hello ${event.context.basicAuth?.username}!`, [auth]);
 * serve(app, { port: 3000 });
 */
export function basicAuth(opts: BasicAuthOptions): Middleware {
  return async (event, next) => {
    await requireBasicAuth(event, opts);
    return next();
  };
}

async function authFailed(event: HTTPEvent, realm: string) {
  // Jitter every 401 path uniformly so response timing does not distinguish a
  // malformed/absent header from a well-formed but wrong credential.
  await randomJitter();
  return new HTTPError({
    status: 401,
    statusText: "Authentication required",
    headers: {
      "www-authenticate": `Basic realm="${quoteRealm(realm)}"`,
    },
  });
}

/**
 * Sanitize a realm into an RFC 9110 §5.6.4 quoted-string body.
 *
 * Drops characters outside the qdtext/obs-text charset (control chars and
 * non-Latin-1 code points that would throw when set as a header value) and
 * escapes DQUOTE and backslash as quoted-pairs.
 */
function quoteRealm(realm: string): string {
  return realm.replace(/[^\t\x20-\x7E\x80-\xFF]/g, "").replace(/["\\]/g, "\\$&");
}
