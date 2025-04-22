import { toWebHandler } from "../../src/index.ts";
import { app } from "./app.ts";

const webHandler = toWebHandler(app);

const res = await webHandler(new Request("http://localhost:3000/"), {} as any);

console.log(res);
console.log(await res.text());
