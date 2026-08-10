// Opt-in subpath: the only rules module importing h3's `proxyRequest`, so
// bundles without `proxy` rules avoid it. Register via `handlers: { proxy }` —
// the core registry ships none, and `createRouteRulesMatcher` throws without one.

import { proxyRequest } from "../utils/proxy.ts";
import type { ProxyRuleOptions, RuleHandler } from "./types.ts";
import { prepareRuleTarget } from "./handlers/_utils.ts";

/**
 * Proxy rule handler: forwards the request to the rule's `to` target.
 * For `/**` targets, the raw `event.url.pathname` is forwarded after the
 * shared scope check (encoded separators stay opaque) — see {@link prepareRuleTarget}.
 */
export const proxy: RuleHandler<"proxy"> = {
  handler: (m) => {
    const options = m.options as ProxyRuleOptions | undefined;
    // `to`-derived setup runs once per handler; the resolver only does
    // per-request work (scope checks, query forwarding).
    const resolveTarget = prepareRuleTarget(options);
    if (!resolveTarget) {
      return function proxyRouteRule() {};
    }
    return function proxyRouteRule(event) {
      return proxyRequest(event, resolveTarget(event), { ...options });
    };
  },
};
