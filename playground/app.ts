import { createApp, createRouter, eventHandler } from "h3";

export const app = createApp();

const router = createRouter();
app.use(router);

router.get(
  "/",
  eventHandler((event) => {
    return { path: event.path, message: "Hello World!" };
  }),
);
