import { H3, serve, redirect } from "h3";

export const app = new H3();

app
  .get("/unjs", (event) => {
    return redirect(event, "https://unjs.io/packages/h3"); // 302 Found by default
  })
  .get("/permanent", (event) => {
    // You can use any 3xx status code you want
    return redirect(event, "https://unjs.io/packages/h3", 301);
  });

serve(app);
