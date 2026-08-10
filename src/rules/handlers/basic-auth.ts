import { requireBasicAuth } from "../../utils/auth.ts";
import type { BasicAuthOptions } from "../../utils/auth.ts";
import type { RuleHandler } from "../types.ts";

// order: -2, outer to `headers`/`redirect`/`proxy`/`cache` — auth failure throws before any of them run.
export const basicAuth: RuleHandler<"basicAuth"> = {
  order: -2,
  handler: (m) =>
    async function authRouteRule(event, next) {
      if (!m.options) {
        return;
      }
      await requireBasicAuth(event, m.options as BasicAuthOptions);
      return next();
    },
};
