import type { RuleHandler } from "../types.ts";

// order: -1. Sets headers after `next()` so they win even when an inner rule
// (e.g. `cache`) short-circuits and overwrites headers like `cache-control` (h3js/h3-rules#5).
//
// `finally`, not a plain post-`next()` loop: a downstream throw unwinds past the
// `await`, and the rule's headers must still apply to the resulting error
// response. Both header bags are set for the same reason — `prepareResponse`
// serves `event.res.errHeaders` (not `event.res.headers`) for status >= 400, so
// a `headers`-only bag vanishes on every 4xx/5xx (mirrors h3's own
// `setCorsHeaders`, `src/utils/cors.ts`).
export const headers: RuleHandler<"headers"> = {
  order: -1,
  handler: (m) => {
    const entries = Object.entries(m.options || {});
    return async function headersRouteRule(event, next) {
      try {
        return await next();
      } finally {
        for (const [key, value] of entries) {
          event.res.headers.set(key, value);
          event.res.errHeaders.set(key, value);
        }
      }
    };
  },
};
