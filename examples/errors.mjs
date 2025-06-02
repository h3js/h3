import { H3, serve, createError } from "h3";

export const app = new H3({ debug: true });

app
  .get("/", () => {
    // Always "throw" errors to propagate them to the error handler
    throw createError({ statusMessage: "Simple error!", statusCode: 301 });
  })
  .get("/complex-error", () => {
    console.log("complex-error");
    // You can fully customize errors by adding data, cause and if it's a fatal error or not
    throw createError({
      status: 400,
      message: "Bad request",
      statusMessage: "Bad request message",
    });
  })
  .get("/fatal-error", () => {
    // Fatal errors will stop the execution of the current request and will be logged
    throw createError({
      status: 500,
      message: "Fatal error",
      fatal: true,
      data: { foo: "bar" },
    });
  });

serve(app);
