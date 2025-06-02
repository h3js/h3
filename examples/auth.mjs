import { H3, serve, basicAuth } from "h3";

export const app = new H3();

const auth = basicAuth({ password: "test", realm: "(password is test)" });

app.get("/", (event) => `Hello ${event.context.basicAuth?.username}!`, [auth]);

serve(app);
