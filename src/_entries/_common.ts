import type { H3 } from "../h3.ts";

export function freezeApp(app: H3): void {
  // @ts-expect-error
  app.config = Object.freeze(app.config);

  app._addRoute = () => {
    throw new Error("Cannot add routes after the server init.");
  };
}
