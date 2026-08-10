import type { RuleHandler } from "../types.ts";

// order: -1. Sets headers after `next()` so they win even when an inner rule
// (e.g. `cache`) short-circuits and overwrites headers like `cache-control` (h3js/h3-rules#5).
export const headers: RuleHandler<"headers"> = {
  order: -1,
  handler: (m) => {
    const entries = Object.entries(m.options || {});
    return async function headersRouteRule(event, next) {
      const response = await next();
      for (const [key, value] of entries) {
        event.res.headers.set(key, value);
      }
      return response;
    };
  },
};
