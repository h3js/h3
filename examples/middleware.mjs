import { H3, serve, createError, onRequest, onResponse, onError } from "h3";

const app = new H3({ debug: true });

app
  .get("/", () => {
    return "Hello, World!";
  })
  .get("/error", () => {
    throw createError({ statusMessage: "I'm a teapot", statusCode: 418 });
  });

app
  .use(
    onRequest((event) => {
      console.log(`[${event.req.method}] ${event.url.pathname}`);
    }),
  )
  .use(
    onResponse((event, { body }) => {
      console.log(`[${event.req.method}] ${event.url.pathname} ~>`, body);
    }),
  )
  .use(
    onError((event, error) => {
      console.log(
        `[${event.req.method}] ${event.url.pathname} !! ${error.message}`,
      );
    }),
  );

serve(app);
