import { H3, serve } from "h3";

const app = new H3();

app
  .get("/", () => "Try sending a POST request with a body!")
  .post("/", async (event) => {
    return {
      body: await event.req.json(),
    };
  });

serve(app);
