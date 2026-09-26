import { redirect as sendRedirect } from "../../utils/response.ts";
import type { RedirectRuleOptions, RuleHandler } from "../types.ts";
import { prepareAtTargetCheck } from "./_at-target.ts";
import { prepareRuleTarget } from "./_utils.ts";

// order: 1, innermost band with `proxy` (2) and `cache` (3). The terminating
// rules must each have a distinct explicit order: they never call `next()`, so
// whichever runs first swallows the rest — and with a shared order the sort is
// only stable, i.e. decided by the order the matched layers merged in (broad →
// narrow), so a broad `cache` would swallow a narrow `redirect`. Positioned
// after the `0` default so a custom rule (a gate written without an explicit
// `order`) still runs ahead of every built-in terminator.
export const redirect: RuleHandler<"redirect"> = {
  order: 1,
  handler: (m) => {
    const options = m.options as RedirectRuleOptions | undefined;
    const resolveTarget = prepareRuleTarget(options);
    if (!resolveTarget) {
      return function redirectRouteRule() {};
    }
    // A request already at the target's shape stands down instead of looping.
    const isAtTarget = prepareAtTargetCheck(options);
    return function redirectRouteRule(event) {
      // Resolve first, so a request the rule rejects (400) stays rejected
      // rather than being skipped through to the app.
      const location = resolveTarget(event);
      if (isAtTarget?.(event)) {
        return;
      }
      return sendRedirect(location, options?.status);
    };
  },
};
