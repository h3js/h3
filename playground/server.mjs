import { H3 } from "h3";

// Learn more about H3 usage: https://h3.dev/guide

const app = new H3({ debug: true });

app.get("/", () => "⚡️ Tadaa!");

export default app;
