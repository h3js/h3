import { H3, serve } from "h3";

export const app = new H3();

app
  .get("/", () => "hello world")
  .get("/json", () => {
    // Automatically set the `Content-Type` header to `application/json`.
    return {
      hello: "world",
    };
  })
  .get("/html", (event) => {
    event.res.headers.set("Content-Type", "text/html");
    return "<h1>hello world</h1>";
  })
  .get("/buffer", () => {
    return Buffer.from("hello world");
  })
  .get("/blob", () => {
    return new Blob(["hello world"]);
  });

serve(app);
