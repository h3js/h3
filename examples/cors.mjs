import { H3, serve, handleCors } from "h3";

export const app = new H3();

app.all("/hello", (event) => {
  const corsRes = handleCors(event, { origin: "*", methods: "*" });
  if (corsRes !== false) {
    return corsRes;
  }
  return "Hello World!";
});

serve(app);
