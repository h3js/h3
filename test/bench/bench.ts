import { bench, summary, compact, run } from "mitata";
import { getRequests } from "./input.ts";
import { createInstances } from "./bench.impl.ts";

const instances = createInstances();

compact(() => {
  summary(() => {
    for (const [name, _fetch] of instances) {
      bench(name, function* () {
        yield {
          [0]: getRequests,
          async bench(requests: ReturnType<typeof getRequests>) {
            await Promise.all(requests.map((request) => _fetch(request.req)));
          },
        };
      }).gc("once");
    }
  });
});

await run({ throw: true });
