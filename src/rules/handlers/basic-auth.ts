import { requireBasicAuth } from "../../utils/auth.ts";
import type { BasicAuthOptions } from "../../utils/auth.ts";
import { HTTPError } from "../../error.ts";
import type { RuleHandler } from "../types.ts";

// order: -2, outer to `headers`/`redirect`/`proxy`/`cache` — auth failure throws before any of them run.
export const basicAuth: RuleHandler<"basicAuth"> = {
  order: -2,
  // A gate: re-adding it through an alternate reading can only fail closed, so
  // a `false` exemption resolved by one reading does not carry over to a
  // reading the exemption's pattern does not cover (see `RuleHandler.restricting`).
  restricting: true,
  handler: (m) => {
    // Fail closed: only `false` disables auth, and the merge resolves that away
    // before a handler is ever built — so any other falsy options value here is a
    // misconfiguration (config-time validation rejects it too). Returning
    // `undefined` would delegate to `next()` and serve the guarded route
    // unauthenticated, so reject instead. Checked once per match, not per request.
    if (!m.options) {
      const message = `[h3] rules: \`basicAuth\` rule for \`${m.route}\` has no options (\`${String(m.options)}\`) — use \`false\` to disable auth, or provide \`{ username, password }\``;
      // Fresh error per request (h3 annotates the thrown error while rendering
      // it). `unhandled` keeps the config detail out of the response body — it
      // is logged server-side instead, like any other server-side bug.
      return function invalidAuthRouteRule() {
        throw new HTTPError({ status: 500, message, unhandled: true });
      };
    }
    return async function authRouteRule(event, next) {
      await requireBasicAuth(event, m.options as BasicAuthOptions);
      return next();
    };
  },
};
