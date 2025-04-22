import { createServer } from "node:http";
import { toNodeHandler } from "../../src/index.ts";
import { app } from "./app.ts";

createServer(toNodeHandler(app)).listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
