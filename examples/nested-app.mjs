import { H3, serve, redirect } from "h3";

const nestedApp = new H3().get("/test", () => "/test (sub app)");

const app = new H3()
  .get("/", (event) => redirect(event, "/api/test"))
  .mount("/api", nestedApp);

serve(app);
