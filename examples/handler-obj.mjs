import { H3, serve, defineHandler } from "h3";

export const app = new H3();

app.get(
  "/",
  defineHandler({
    onRequest: () => {
      // Do anything you want here like authentication, rate limiting, etc.
      console.log("onRequest");
      // Never return anything from onRequest to avoid to close the connection
    },
    onResponse: () => {
      // Do anything you want here like logging, collecting metrics, or output compression, etc.
      console.log("onResponse");
      // Never return anything from onResponse to avoid to close the connection
    },
    handler: () => "GET: hello world",
  }),
);

serve(app);
