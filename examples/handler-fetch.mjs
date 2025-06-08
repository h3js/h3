import { defineHandler } from "h3"; // 5kB (2kB gzipped)

const log = (event) => {
  console.log(`[${event.req.method}] ${event.req.url}`);
};

// ✔ Inferred Types: (event: H3Event<EventHandlerRequest>) => { hello: string; }
const handler = defineHandler({
  // ✔ Request middleware
  middleware: [log],
  // ✔ Directly return a value or throw an error
  handler: () => ({ hello: "world" }),
});

// ✔ compatible with .fetch API
// Use for teesting or integrate into any compatible framework and runtime!
// [GET] http://localhost/test
// { hello: "world" }
console.log(await handler.fetch("/test").then((res) => res.json()));
