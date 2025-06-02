import { H3, serve, redirect, withBase } from "h3";

const nestedApp = new H3().get("/test", () => "/test (sub app)");

const app = new H3()
  .get("/", (event) => redirect(event, "/api/test"))
  .all("/api/**", withBase("/api", nestedApp.handler));

serve(app);
