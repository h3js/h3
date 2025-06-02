import { H3, serve } from "h3";

export const app = new H3();

app.get("/", (event) => {
  return `Hello ${event.url.searchParams.get("name") || "anonymous"}!`;
});

serve(app);
