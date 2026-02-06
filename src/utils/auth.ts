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

  const authHeader = event.req.headers.get("authorization");
  if (!authHeader) {
    throw authFailed(event);
  }
  const [authType, b64auth] = authHeader.split(" ");
  if (!b64auth || authType.toLowerCase() !== "basic") {
    throw authFailed(event, opts?.realm);
  }
  let authDecoded: string;
  try {
    authDecoded = atob(b64auth);
  } catch {
    throw authFailed(event, opts?.realm);
  }
  const colonIndex = authDecoded.indexOf(":");
  const username = authDecoded.slice(0, colonIndex);
  const password = authDecoded.slice(colonIndex + 1);
  if (!username || !password) {
    throw authFailed(event, opts?.realm);
  }

  if (
    (opts.username && !timingSafeEqual(username, opts.username)) ||
    (opts.password && !timingSafeEqual(password, opts.password)) ||
    (opts.validate && !(await opts.validate(username, password)))
  ) {
    await randomJitter();
    throw authFailed(event, opts?.realm);
  }

  const context = getEventContext<H3EventContext>(event);
  context.basicAuth = { username, password, realm: opts.realm };

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

function authFailed(event: HTTPEvent, realm: string = "") {
  return new HTTPError({
    status: 401,
    statusText: "Authentication required",
    headers: {
      "www-authenticate": `Basic realm=${JSON.stringify(realm)}`,
    },
  });
}
