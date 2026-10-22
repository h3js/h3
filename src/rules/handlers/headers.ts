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
//
// An `errHeaders` key staged *inside* `next()` is left alone: it is the handler
// opting its own error response out (e.g. `cache-control: no-store` on a 404 under
// an immutable asset rule, h3js/h3#1612). Keys staged before the rule ran (outer
// `cors` rule, middleware) are still overridden, as on success responses. An inner
// `toResponse` (the `cache` rule renders the handler itself) resets `event.res`;
// the fresh bag has nothing to compare against, so every rule key is set then.
// A change made by a nested `headers` rule (stacked `routeRules()`, mounted app)
// is not an opt-out: the outer rule still wins, as it does on success responses.
const ruleWrites = new WeakMap<Headers, Map<string, string>>();

export const headers: RuleHandler<"headers"> = {
  order: -1,
  handler: (m) => {
    const entries = Object.entries(m.options || {}).map(
      ([key, value]) => [key.toLowerCase(), value] as const,
    );
    return async function headersRouteRule(event, next) {
      const before = event.res.errHeaders;
      const staged = entries.map(([key]) => before.get(key));
      try {
        return await next();
      } finally {
        const res = event.res;
        const errHeaders = res.errHeaders;
        const reset = errHeaders !== before;
        let written = ruleWrites.get(errHeaders);
        for (let i = 0; i < entries.length; i++) {
          const [key, value] = entries[i]!;
          res.headers.set(key, value);
          const current = errHeaders.get(key);
          if (reset || current === staged[i] || written?.get(key) === current) {
            errHeaders.set(key, value);
            if (!written) ruleWrites.set(errHeaders, (written = new Map()));
            written.set(key, errHeaders.get(key)!);
          }
        }
      }
    };
  },
};
