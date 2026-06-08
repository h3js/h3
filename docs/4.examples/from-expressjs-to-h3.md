---
icon: ph:arrow-right
---

# From Express.js to h3

> A practical migration guide for Express.js developers moving to h3 v2.

h3 has a familiar routing API for Express developers, but is built on web standards, requires no middleware for common tasks, and is runtime-agnostic (Node.js, Bun, Deno, edge runtimes).

## Hello World

**Express.js**

```js
import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(3000);
```

**h3**

```js
import { H3, serve } from "h3";

const app = new H3();

app.get("/", () => "Hello World!");

serve(app, { port: 3000 });
```

Key differences:

- `new H3()` replaces `express()`
- Handlers **return** the response body instead of calling `res.send()`
- `serve(app)` starts the server (powered by [srvx](https://srvx.h3.dev/))

## Routing

**Express.js**

```js
const app = express();

app.get("/users", (req, res) => res.json({ users: [] }));
app.post("/users", (req, res) => res.json({ created: true }));
app.delete("/users/:id", (req, res) => res.json({ deleted: req.params.id }));
```

**h3**

```js
import { H3, serve, getRouterParam } from "h3";

const app = new H3();

app
  .get("/users", () => ({ users: [] }))
  .post("/users", () => ({ created: true }))
  .delete("/users/:id", (event) => ({ deleted: getRouterParam(event, "id") }));

serve(app);
```

h3 returns JSON automatically when you return a plain object.

## URL Params

**Express.js**

```js
app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  res.send(`User: ${id}`);
});
```

**h3**

```js
import { H3, serve, getRouterParam, getRouterParams } from "h3";

const app = new H3();

// Single param
app.get("/users/:id", (event) => {
  const id = getRouterParam(event, "id");
  return `User: ${id}`;
});

// All params at once
app.get("/posts/:category/:slug", (event) => {
  const { category, slug } = getRouterParams(event);
  return `${category}/${slug}`;
});

serve(app);
```

For validated params, use `getValidatedRouterParams` with any [Standard Schema](https://github.com/standard-schema/standard-schema) compatible library (Zod, Valibot, ArkType):

```js
import { H3, serve, getValidatedRouterParams } from "h3";
import * as z from "zod";

const app = new H3();

app.get("/users/:id", async (event) => {
  const params = await getValidatedRouterParams(event, z.object({
    id: z.string().uuid(),
  }));
  return `User: ${params.id}`;
});

serve(app);
```

:read-more{to="/examples/validate-data"}

## Query String

**Express.js**

```js
app.get("/search", (req, res) => {
  const q = req.query.q;
  res.send(`Searching for: ${q}`);
});
```

**h3**

```js
import { H3, serve, getQuery } from "h3";

const app = new H3();

app.get("/search", (event) => {
  const { q } = getQuery(event);
  return `Searching for: ${q}`;
});

serve(app);
```

## Request Body

Express requires `express.json()` middleware. h3 parses the body automatically.

**Express.js**

```js
const app = express();
app.use(express.json()); // required

app.post("/users", (req, res) => {
  const { name } = req.body;
  res.json({ name });
});
```

**h3**

```js
import { H3, serve, readBody } from "h3";

const app = new H3();

app.post("/users", async (event) => {
  const { name } = await readBody(event);
  return { name };
});

serve(app);
```

No body-parsing middleware needed — h3 handles JSON, form data, and text automatically.

## Cookies

Express requires the `cookie-parser` package. h3 has built-in cookie utilities.

**Express.js**

```js
import cookieParser from "cookie-parser";

const app = express();
app.use(cookieParser()); // required

app.get("/", (req, res) => {
  const token = req.cookies.token;
  res.cookie("token", "abc123", { httpOnly: true });
  res.send(`Token was: ${token}`);
});
```

**h3**

```js
import { H3, serve, getCookie, setCookie } from "h3";

const app = new H3();

app.get("/", (event) => {
  const token = getCookie(event, "token");
  setCookie(event, "token", "abc123", { httpOnly: true });
  return `Token was: ${token}`;
});

serve(app);
```

:read-more{to="/examples/handle-cookie"}

## Middleware

h3 v2 provides lifecycle hooks for request/response middleware instead of a generic `app.use(fn)` middleware chain.

**Express.js**

```js
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path}`);
  next();
});
```

**h3**

```js
import { H3, serve, onRequest, onResponse } from "h3";

const app = new H3();

app
  .use(onRequest((event) => {
    console.log(`[${event.req.method}] ${event.url.pathname}`);
  }))
  .use(onResponse((response, event) => {
    console.log(`[${event.req.method}] ${event.url.pathname} -> ${response.statusCode}`);
  }));

app.get("/", () => "Hello World!");

serve(app);
```

## Sub-apps / Nested Routers

**Express.js**

```js
import express from "express";

const apiRouter = express.Router();
apiRouter.get("/users", (req, res) => res.json({ users: [] }));

const app = express();
app.use("/api", apiRouter);
```

**h3**

```js
import { H3, serve } from "h3";

const apiApp = new H3();
apiApp.get("/users", () => ({ users: [] }));

const app = new H3();
app.mount("/api", apiApp);

serve(app);
```

`app.mount(prefix, subApp)` replaces `app.use(prefix, router)`. Handlers in `apiApp` receive paths relative to `/api`.

## Error Handling

**Express.js**

```js
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});
```

**h3**

```js
import { H3, serve, HTTPError, onError } from "h3";

const app = new H3();

// Throw typed HTTP errors from any handler
app.get("/protected", () => {
  throw HTTPError.status(401, "Unauthorized");
});

// Global error hook
app.use(onError((event, error) => {
  console.error(error.message);
}));

serve(app);
```

h3 automatically sends the correct HTTP status and JSON error body when you throw an `HTTPError`.

## What's Not Available in h3 v2

| Express feature | h3 v2 equivalent |
| --- | --- |
| `express.json()` | Built-in — use `readBody()` |
| `cookie-parser` | Built-in — use `getCookie()` / `setCookie()` |
| `express.static()` | Built-in — use `serveStatic()` |
| `res.redirect()` | `return redirect(event, url)` |
| `fromNodeMiddleware()` | Not available in v2 (web-standards based) |
| `createApp()` / `createRouter()` | Replaced by `new H3()` |

> [!NOTE]
> h3 v2 is built on web standard primitives and is no longer tied to Node.js-specific APIs. Express middleware that relies on `req`/`res` Node.js objects cannot be used directly.
