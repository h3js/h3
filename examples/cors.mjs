import { H3, serve, handleCors } from "h3";

export const app = new H3();

// Answer CORS preflights and add headers for all routes
app.use((event) => {
  if (handleCors(event, { origin: "*" })) {
    return;
  }
});

app.get("/hello", () => "Hello World!");

app.post("/api/data", async (event) => {
  const body = await event.req.json();
  return { ok: true, body };
});

serve(app);
