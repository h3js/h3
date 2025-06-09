import { H3, serve, definePlugin } from "h3";

export const logger = (_options) =>
  definePlugin((h3) => {
    if (h3.config.debug) {
      h3.use((req) => {
        console.log(`[${req.method}] ${req.url}`);
      });
    }
  });

const app = new H3({ debug: true })
  .register(logger())
  .all("/**", () => "Hello!");

serve(app);
