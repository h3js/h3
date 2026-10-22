import type { HTTPError } from "../../error.ts";
import type { H3Event } from "../../event.ts";
import type { RuleHandler } from "../types.ts";

// order: -1. Sets headers after `next()` so they win even when an inner rule
// (e.g. `cache`) short-circuits and overwrites headers like `cache-control` (h3js/h3-rules#5).
//
// Applied on both the return and the throw path: a downstream throw unwinds past
// the `await`, and the rule's headers must still apply to the resulting error
// response. Both header bags are set for the same reason — `prepareResponse`
// serves `event.res.errHeaders` (not `event.res.headers`) for status >= 400, so
// a `headers`-only bag vanishes on every 4xx/5xx (mirrors h3's own
// `setCorsHeaders`, `src/utils/cors.ts`).
//
// An `HTTPError` (thrown or returned) that carries one of the rule's keys in its
// own `headers` keeps it: that is the handler explicitly opting its error response
// out (e.g. `cache-control: no-store` on a 404 under an immutable asset rule,
// h3js/h3#1612). `errHeaders` would otherwise win over `error.headers`.
export const headers: RuleHandler<"headers"> = {
  order: -1,
  handler: (m) => {
    const entries = Object.entries(m.options || {});
    return async function headersRouteRule(event, next) {
      let result: unknown;
      try {
        result = await next();
      } catch (error) {
        setRuleHeaders(event, entries, error);
        throw error;
      }
      setRuleHeaders(event, entries, result);
      return result;
    };
  },
};

function setRuleHeaders(event: H3Event, entries: [string, string][], outcome: unknown): void {
  // Inlined `HTTPError.isError`: importing `HTTPError` would pull `error.ts` into
  // every `headers`-only bundle (test/rules/treeshake.test.ts budget).
  const own =
    outcome instanceof Error && outcome.name === "HTTPError" && (outcome as HTTPError).status > 99
      ? (outcome as HTTPError).headers
      : undefined;
  for (const [key, value] of entries) {
    event.res.headers.set(key, value);
    if (!own?.has(key)) {
      event.res.errHeaders.set(key, value);
    }
  }
}
