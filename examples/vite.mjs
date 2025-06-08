// This example works with Node.js, Deno and Bun through Node.js compatibility layer
import { H3, serve, html, fromNodeHandler } from "h3/node";
import { createServer } from "vite";

const app = new H3({ debug: true });

const vite = await createServer({
  root: import.meta.dirname,
  server: { middlewareMode: true },
  appType: "custom",
});

app.use(fromNodeHandler(vite.middlewares));

app.get("/", (event) =>
  html(event, "H3 App + Vite <br> <a href='./vite.mjs'>view source</a>"),
);

serve(app);
