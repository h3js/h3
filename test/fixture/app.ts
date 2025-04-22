import { H3, getQuery } from "../../src/index.ts";

export const app = new H3();

app.get("/**", (event) => {
  return {
    request: {
      method: event.req.method,
      path: event.url.pathname + event.url.search,
      params: getQuery(event),
      headers: Object.fromEntries(event.req.headers.entries()),
    },
  };
});
