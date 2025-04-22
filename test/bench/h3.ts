import { bench, compact, summary, run } from "mitata";
import { requests } from "./input.ts";

import * as _src from "../../src/index.ts";
// import * as _dist from "../../dist/index.mjs";
// import * as _nightly from "h3-nightly";

const preparedRequests = requests.map((request) => {
  return new Request(`http://localhost${request.path}`, {
    method: request.method,
    body: request.body,
  });
});

summary(() => {
  compact(() => {
    for (const [name, { H3, getQuery }] of Object.entries({
      _src,
      // _dist,
      // _nightly,
    })) {
      bench(name, function* () {
        const app = new H3()
          .get("/", () => "Hi")
          .get("/id/:id", (event) => {
            event.res.headers.set("x-powered-by", "benchmark");
            return `${event.context.params?.id} ${getQuery(event).name}`;
          })
          .post("/json", (event) => event.req.json());

        yield async () => {
          await Promise.all(preparedRequests.map((req) => app.fetch(req)));
        };
      }).gc("inner");
    }
  });
});

await run({ throw: true });
