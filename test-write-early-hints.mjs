import { H3 } from "../src/index.ts";

const app = new H3().get("/", async (event) => {
  const start = Date.now();
  await event.node?.writeEarlyHints?.({
    link: "</style.css>; rel=preload; as=style",
  });
  const elapsed = Date.now() - start;
  return `Early hints sent in ${elapsed}ms`;
});

await app.listen({ port: 3000 });
console.log("Server running on http://localhost:3000");