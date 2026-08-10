import { redirect as sendRedirect } from "../../utils/response.ts";
import type { RedirectRuleOptions, RuleHandler } from "../types.ts";
import { prepareRuleTarget } from "./_utils.ts";

export const redirect: RuleHandler<"redirect"> = {
  handler: (m) => {
    const options = m.options as RedirectRuleOptions | undefined;
    const resolveTarget = prepareRuleTarget(options);
    if (!resolveTarget) {
      return function redirectRouteRule() {};
    }
    return function redirectRouteRule(event) {
      return sendRedirect(resolveTarget(event), options?.status);
    };
  },
};
