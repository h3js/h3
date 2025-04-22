import { toWebHandler } from "../../src/index.ts";
import { app } from "./app.ts";

export default {
  fetch: toWebHandler(app),
};
