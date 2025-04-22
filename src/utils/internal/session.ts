import type { SessionConfig } from "../session.ts";

export const kGetSession: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.promise",
);

export const DEFAULT_SESSION_NAME = "h3";

export const DEFAULT_SESSION_COOKIE: SessionConfig["cookie"] = {
  path: "/",
  secure: true,
  httpOnly: true,
};
