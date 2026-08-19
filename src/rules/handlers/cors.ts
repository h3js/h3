import { handleCors } from "../../utils/cors.ts";
import type { CorsOptions } from "../../utils/cors.ts";
import type { RuleHandler } from "../types.ts";

let warnedCredentialsWildcard = false;

// Post-merge defense for `credentials: true` + wildcard origin: normalize-time
// validation can't see combos formed by the shallow per-key merge across rule
// layers (e.g. a broad `credentials: true` narrowed by `origin: "*"`). Mirrors
// h3's own wildcard *emission* condition exactly — `createOriginHeaders` sends
// `Access-Control-Allow-Origin: *` for `!originOption || originOption === "*"`
// (`src/utils/internal/cors.ts`), so any falsy origin counts, not just
// `undefined` (a defined `null`/`""` reaching this check via merge would
// otherwise leak `*` alongside credentials). Array allowlists are fine — they
// reflect a specific origin. Drops `credentials` rather than throwing, since
// browsers reject the `Access-Control-Allow-Origin: *` + credentials pair anyway.
function safeCorsOptions(options: CorsOptions): CorsOptions {
  const { origin, credentials } = options;
  if (credentials === true && (!origin || origin === "*")) {
    if (!warnedCredentialsWildcard) {
      warnedCredentialsWildcard = true;
      console.warn(
        "[h3] rules: `cors` rule resolved to `credentials: true` with a wildcard origin after merge — dropping `credentials` (an `Access-Control-Allow-Origin: *` + credentials response is rejected by browsers). Set an explicit `origin` allowlist on the more specific rule.",
      );
    }
    return { ...options, credentials: false };
  }
  return options;
}

// order: -3, outermost: a CORS preflight (`OPTIONS` + `Origin` +
// `Access-Control-Request-Method`) is answered directly, before any custom gate
// rule (the free `-2` slot) — browsers send preflights without credentials, and
// the response carries only policy headers, no protected data. Do not reorder
// inside such a gate.
//
// For a normal request `handleCors` appends CORS headers and returns `false`;
// a user `headers` rule (`.set`) still wins over these `.append`ed ones.
export const cors: RuleHandler<"cors"> = {
  order: -3,
  handler: (m) =>
    function corsRouteRule(event, next) {
      const preflight = handleCors(event, safeCorsOptions((m.options || {}) as CorsOptions));
      return preflight === false ? next() : preflight;
    },
};
