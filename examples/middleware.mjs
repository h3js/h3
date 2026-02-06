import { H3, serve, HTTPError, onRequest, onResponse, onError } from "h3";

const app = new H3({ debug: true });

app
  .get("/", () => {
    return "Hello, World!";
  })
  .get("/error", () => {
    throw new HTTPError.status(500, "Internal Server Error");
  });

app
  .use(
    onRequest((event) => {
      console.log(`[${event.req.method}] ${event.url.pathname}`);
    }),
  )
  .use(
    onResponse((response, event) => {
      console.log(`[${event.req.method}] ${event.url.pathname} ~> ${response.statusCode}`);
    }),
  )
  .use(
    onError((event, error) => {
      console.log(`[${event.req.method}] ${event.url.pathname} !! ${error.message}`);
    }),
  );

serve(app);
