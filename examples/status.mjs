import { H3, serve, noContent } from "h3";

export const app = new H3();

app
  .get("/not-found", (event) => {
    event.res.status = 404;

    return "Not found"; // You need to explicitly return something to avoid a 404 'Cannot find any path matching "/not-found"' response.
  })
  .get("/bad-request", (event) => {
    const status = 400;
    const text = "Bad request message";

    event.res.status = status;
    event.res.statusText = text; // You can customize the status message.

    return {
      status,
      text,
    };
  })
  .get("/no-content", (event) => {
    return noContent(event);
  });

serve(app);
