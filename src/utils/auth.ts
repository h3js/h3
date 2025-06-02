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
  validate: (auth: {
    username: string;
    password: string;
  }) => boolean | Promise<boolean>;

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
 * Check for basic authentication in the request.
 *
 * Example:
 *
 * ```ts
 * import { requireBasicAuth } from "h3";
 * import { defineEventHandler } from "h3";
 *
 * export default defineEventHandler(async (event) => {
 *  await requireBasicAuth(event, { username: "test", password: "test" });
 *  return `Hello, ${event.context.basicAuth.username}!`;
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
  if (opts.validate && !(await opts.validate({ username, password }))) {
    throw autheFailed(event, opts?.realm);
  }

  event.context.basicAuth = { username, password };

  return true;
}

export function basicAuth(opts: BasicAuthOptions): Middleware {
  return async (event, next) => {
    await requireBasicAuth(event, opts);
    return next();
  };
}

function autheFailed(event: H3Event, realm: string = "auth") {
  event.res.headers.set(
    "www-authenticate",
    `Basic realm=${JSON.stringify(realm)}`,
  );
  return createError({
    statusCode: 401,
    statusMessage: "Authentication required",
  });
}
