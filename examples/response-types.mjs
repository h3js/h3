import { H3, html, serve } from "h3";

export const app = new H3();

app
  .get("/", () => "hello world")
  .get("/json", () => {
    // Automatically set the `Content-Type` header to `application/json`.
    return {
      hello: "world",
    };
  })
  .get("/html", (event) => html(event, "<h1>hello world</h1>"))
  .get("/buffer", () => Buffer.from("hello world"))
  .get("/blob", () => new Blob(["hello world"]))
  .get(
    "/file",
    () => new File(["hello world"], "hello.txt", { type: "text/plain" }),
  );

serve(app);
