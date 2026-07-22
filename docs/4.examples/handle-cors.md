---
icon: ph:globe-hemisphere-west
---

# CORS

> Handle cross-origin requests with H3.

Cross-Origin Resource Sharing (CORS) lets a browser page on one origin call your API on another. Browsers enforce CORS: your server must send the right `Access-Control-*` headers, and many requests also require a successful `OPTIONS` preflight.

H3 provides [`handleCors`](/utils/security#handlecorsevent-options) to append headers and answer preflights. Call it at the start of a handler or in middleware **before** your route logic runs.

## Basic usage

The recommended pattern is to call `handleCors` first and return early when it handles a preflight:

```ts
import { H3, serve, handleCors } from "h3";

const app = new H3();

app.use((event) => {
  if (handleCors(event, { origin: "*" })) {
    return;
  }
});

app.post("/api/data", async (event) => {
  const body = await event.req.json();
  return { ok: true, body };
});

serve(app);
```

`handleCors` returns a response when the request is handled (typically a `204` for `OPTIONS` preflight). When it returns `false`, continue with your handler.

:read-more{to="/utils/security#cors" title="CORS utilities"}

## Per-route CORS

You can also call `handleCors` inside a single route:

```ts
app.get("/hello", (event) => {
  if (handleCors(event, { origin: "https://app.example.com" })) {
    return;
  }
  return "Hello World!";
});
```

## Common pitfalls

### Preflight requests

Browsers send an `OPTIONS` request before many cross-origin calls — for example `POST` with `Content-Type: application/json`. If `handleCors` is not called for that path and method, the preflight fails and the browser reports a CORS error even when your `POST` handler would have worked.

Use middleware (as in the basic example) when several routes need CORS, especially POST-only APIs.

### Simple vs non-simple requests

`GET` requests without custom headers are often [CORS-simple](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests) and may not preflight. Adding headers like `Content-Type: application/json` or `Authorization` triggers a preflight.

### Error responses

When a handler throws, prepared response headers may be dropped. `handleCors` sets both normal and error headers so CORS still applies on failure responses.

:read-more{to="/guide/basics/error" title="Error handling"}

## Using Nitro or Nuxt

In [Nitro](https://nitro.build) apps you can enable CORS with a [`cors` route rule](/docs/routing#cors). Route rules add headers but still require an `OPTIONS` handler for preflight — see the Nitro routing guide for a catch-all example.

In Nuxt, set `routeRules` in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  routeRules: {
    "/api/**": { cors: true },
  },
});
```

## Example

See the full runnable example in [`examples/cors.mjs`](https://github.com/h3js/h3/blob/main/examples/cors.mjs).
