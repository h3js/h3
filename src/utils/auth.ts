import { createError } from "../index.ts";

import type { H3Event, Middleware } from "../index.ts";

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
  (
    | { validate: _BasicAuthOptions["validate"] }
    | { password: _BasicAuthOptions["password"] }
  );

/**
 * Apply basic authentication for current request.
 *
 * @example
 * import { defineEventHandler, requireBasicAuth } from "h3";
 * export default defineEventHandler(async (event) => {
 *   await requireBasicAuth(event, { password: "test" });
 *   return `Hello, ${event.context.basicAuth.username}!`;
 * });
 */
export async function requireBasicAuth(
  event: H3Event,
  opts: BasicAuthOptions,
): Promise<true> {
  if (!opts.validate && !opts.password) {
    throw new Error(
      "You must provide either a validate function or a password for basic auth.",
    );
  }

  const authHeader = event.req.headers.get("authorization");
  if (!authHeader) {
    throw autheFailed(event);
  }
  const [authType, b64auth] = authHeader.split(" ");
  if (authType !== "Basic" || !b64auth) {
    throw autheFailed(event, opts?.realm);
  }
  const [username, password] = atob(b64auth).split(":");
  if (!username || !password) {
    throw autheFailed(event, opts?.realm);
  }

  if (opts.username && username !== opts.username) {
    throw autheFailed(event, opts?.realm);
  }
  if (opts.password && password !== opts.password) {
    throw autheFailed(event, opts?.realm);
  }
  if (opts.validate && !(await opts.validate(username, password))) {
    throw autheFailed(event, opts?.realm);
  }

  event.context.basicAuth = { username, password, realm: opts.realm };

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

function autheFailed(event: H3Event, realm: string = "") {
  return createError({
    statusCode: 401,
    statusMessage: "Authentication required",
    headers: {
      "www-authenticate": `Basic realm=${JSON.stringify(realm)}`,
    },
  });
}
