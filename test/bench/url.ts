import { bench, compact, summary, group, run, do_not_optimize } from "mitata";
import { FastURL } from "../../src/url.ts";

const input = "https://user:password@example.com/path/to/resource?query=string";

const scenarios = {
  pathname: (url: URL) => do_not_optimize([url.pathname]),
  params: (url: URL) => do_not_optimize([url.searchParams.get("query")]),
  "pathname+params": (url: URL) =>
    do_not_optimize([url.pathname, url.searchParams.get("query")]),
  "pathname+params+username": (url: URL) =>
    do_not_optimize([
      url.pathname,
      url.searchParams.get("query"),
      url.username,
    ]),
};

for (const [name, fn] of Object.entries(scenarios)) {
  group(name, () => {
    summary(() => {
      compact(() => {
        bench("globalThis.URL", () => do_not_optimize(fn(new URL(input)))).gc(
          "inner",
        );
        bench("FastURL", () => do_not_optimize(fn(new FastURL(input)))).gc(
          "inner",
        );
      });
    });
  });
}

await run({ throw: true });
