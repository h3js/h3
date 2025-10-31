---
icon: icons8:up-round
---

# Migration guide for v1 to v2

H3 version 2 includes some behavior and API changes that you need to consider applying when migrating.

> [!NOTE]
> Currently H3 v2 in beta stage. You can try with [nightly channel](/guide/advanced/nightly).

> [!NOTE]
> This is an undergoing migration guide and might be updated.

> [!TIP]
> H3 has a brand new documentation rewrite. Head to the new [Guide](/guide) section to learn more!

## Latest Node.js and ESM-only

> [!TIP]
> H3 v2 requires Node.js >= 20.11 (latest LTS recommended) .

If your application is currently using CommonJS modules (`require` and `module.exports`), You can still use `require("h3")` thanks to `require(esm)` supported in latest Node.js versions.

You can alternatively use other compatible runtimes [Bun](https://bun.sh/) or [Deno](https://deno.com/).

## Web Standards

> [!TIP]
> H3 v2 is rewritten based on web standard primitives ([`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL), [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers), [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request), and [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)).

When using Node.js, H3 uses a compatibility layer ([💥 srvx](https://srvx.h3.dev/guide/node)) and in other runtimes uses native web compatibility APIs.

Access to the native `event.node.{req,res}` is only available when running server in Node.js runtime.

`event.web` is renamed to `event.req` (instance of web [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request)).

## Response Handling

> [!TIP]
> You should always explicitly **return** the response body or **throw** an error.

If you were previously using methods below, you can replace them with `return` statements returning a text, JSON, stream, or web `Response` (h3 smartly detects and handles each):

- `send(event, value)`: Migrate to `return <value>`.
- `sendError(event, <error>)`: Migrate to `throw createError(<error>)`.
- `sendStream(event, <stream>)`: Migrate to `return <stream>`.
- `sendWebResponse(event, <response>)`: Migrate to `return <response>`.

Other send utils that are renamed and need explicit `return`:

- `sendNoContent(event)` / `return null`: Migrate to `return noContent(event)`.
- `sendIterable(event, <value>)`: Migrate to `return iterable(event, <value>)`.
- `sendProxy(event, target)`: Migrate to `return proxy(event, target)`.
- `handleCors(event)`: Check return value and early `return` if handled(not `false`).
- `serveStatic(event, content)`: Make sure to add `return` before.
- `sendRedirect(event, location, code)`: Migrate to `return redirect(event, location, code)`.

:read-more{to="/guide/basics/response" title="Sending Response"}

## H3 and Router

> [!TIP]
> Router function is now integrated into the H3 core.
> <br> Instead of `createApp()` and `createRouter()` you can use [`new H3()`](/guide/api/h3).

Any handler can return a response. If middleware don't return a response, next handlers will be tried and finally make a 404 if neither responses. Router handlers can return or not return any response, in this case, H3 will send a simple 200 with empty content.

:read-more{to="/guide/basics/lifecycle" title="Request Lifecycle"}

H3 migrated to a brand new route-matching engine ([🌳 rou3](https://rou3.h3.dev/)). You might experience slight (but more intuitive) behavior changes for matching patterns.

**Other changes from v1:**

- Middleware added with `app.use("/path", handler)` only matches `/path` (not `/path/foo/bar`). For matching all subpaths like before, it should be updated to `app.use("/path/**", handler)`.
- The `event.path` received in each handler will have a full path without omitting the prefixes. use `withBase(base, handler)` utility to make prefixed app. (example: `withBase("/api", app.handler)`).
- **`router.add(path, method: Method | Method[]` signature is changed to `router.add(method: Method, path)`**
- `router.use(path, handler)` is deprecated. Use `router.all(path, handler)` instead.
- `app.use(() => handler, { lazy: true })` is no supported anymore. Instead you can use `app.use(defineLazyEventHandler(() => handler), { lazy: true })`.
- `app.use(["/path1", "/path2"], ...)` and `app.use("/path", [handler1, handler2])` are not supported anymore. Instead, use multiple `app.use()` calls.
- `app.resolve(path)` removed.

:read-more{to="/guide/basics/routing" title="Routing"}

:read-more{to="/guide/basics/middleware" title="Middleware"}

## Request Body

> [!TIP]
> Most of request body utilities can now be replaced with native `event.req.*` methods which is based on web [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Response) interface.

`readBody(event)` utility will use [`JSON.parse`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse) or [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) for parsing requests with `application/x-www-form-urlencoded` content-type.

- For text: Use [event.req.text()](https://developer.mozilla.org/en-US/docs/Web/API/Request/text).
- For json: Use [event.req.json()](https://developer.mozilla.org/en-US/docs/Web/API/Request/json).
- For formData: Use [event.req.formData()](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData).
- For stream: Use [event.req.body](https://developer.mozilla.org/en-US/docs/Web/API/Request/body).

**Behavior changes:**

- Body utils won't throw an error if the incoming request has no body (or is a `GET` method for example) but instead, return empty values.
- Native `request.json` and `readBody` does not use [unjs/destr](https://destr.unjs.io) anymore. You should always filter and sanitize data coming from user to avoid [prototype-poisoning](https://medium.com/intrinsic-blog/javascript-prototype-poisoning-vulnerabilities-in-the-wild-7bc15347c96).

## Cookie and Headers

> [!TIP]
> H3 now natively uses standard web [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) for all utils.

Header values are always a plain `string` now (no `null` or `undefined` or `number` or `string[]`).

For the [`Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) header, you can use [`headers.getSetCookie`](https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie) that always returns a string array.

## Other Deprecations

H3 v2 deprecated some legacy and aliased utilities.

### App and router utils

- `createApp` / `createRouter`: Migrate to `new H3()`.

### Error utils

- `createError`/`H3Error`: Migrate to `HTTPError`
- `isError`: Migrate to `HTTPError.isError`

### Handler utils

- `eventHandler`/`defineEventHandler`: Migrate to `defineHandler` (you can also directly use a function!).
- `lazyEventHandler`: Migrate to `defineLazyEventHandler`.
- `isEventHandler`: (removed) Any function can be an event handler.
- `useBase`: Migrate to `withBase`.
- `defineRequestMiddleware` and `defineResponseMiddleware` removed.

### Request utils

- `getHeader` / `getRequestHeader`: Migrate to `event.req.headers.get(name)`.
- `getHeaders` / `getRequestHeaders`: Migrate to `Object.fromEntries(event.req.headers.entries())`.
- `getRequestPath`: Migrate to `event.path` or `event.url`.
- `getMethod`: Migrate to `event.method`.

### Response utils

- `getResponseHeader` / `getResponseHeaders`: Migrate to `event.res.headers.get(name)`
- `setHeader` / `setResponseHeader` / `setHeaders` / `setResponseHeaders`: Migrate to `event.res.headers.set(name, value)`.
- `appendHeader` / `appendResponseHeader` / `appendResponseHeaders`: Migrate to `event.res.headers.append(name, value)`.
- `removeResponseHeader` / `clearResponseHeaders`: Migrate to `event.res.headers.delete(name)`
- `appendHeaders`: Migrate to `appendResponseHeaders`.
- `defaultContentType`: Migrate to `event.res.headers.set("content-type", type)`
- `getResponseStatus` / `getResponseStatusText` / `setResponseStatus`: Use `event.res.status` and `event.res.statusText`.

### Node.js utils

- `defineNodeListener`: Migrate to `defineNodeHandler`.
- `fromNodeMiddleware`: Migrate to `fromNodeHandler`.
- `toNodeListener`: Migrate to `toNodeHandler`.
- `createEvent`: (removed): Use Node.js adapter (`toNodeHandler(app)`).
- `fromNodeRequest`: (removed): Use Node.js adapter (`toNodeHandler(app)`).
- `promisifyNodeListener` (removed).
- `callNodeListener`: (removed).

### Web Utils

- `fromPlainHandler`: (removed) Migrate to Web API.
- `toPlainHandler`: (removed) Migrate to Web API.
- `fromPlainRequest` (removed) Migrate to Web API or use `mockEvent` util for testing.
- `callWithPlainRequest` (removed) Migrate to Web API.
- `fromWebRequest`: (removed) Migrate to Web API.
- `callWithWebRequest`: (removed).

### Body Utils

- `readRawBody`: Migrate to `event.req.text()` or `event.req.arrayBuffer()`.
- `getBodyStream` / `getRequestWebStream`: Migrate to `event.req.body`.
- `readFormData` / `readMultipartFormData` / `readFormDataBody`: Migrate to `event.req.formData()`.

### Other Utils

- `isStream`: Migrate to `instanceof ReadableStream`.
- `isWebResponse`: Migrate to `instanceof Response`.
- `splitCookiesString`: Use `splitSetCookieString` from [cookie-es](https://github.com/unjs/cookie-es).
- `MIMES`: (removed).

### Type Exports

> [!NOTE]
> There might be more type changes.

- `App`: Migrate to `H3`.
- `AppOptions`: Migrate to `H3Config`.
- `_RequestMiddleware`: Migrate to `RequestMiddleware`.
- `_ResponseMiddleware`: Migrate to `ResponseMiddleware`.
- `NodeListener`: Migrate to `NodeHandler`.
- `TypedHeaders`: Migrate to `RequestHeaders` and `ResponseHeaders`.
- `HTTPHeaderName`: Migrate to `RequestHeaderName` and `ResponseHeaderName`.
- `H3Headers`: Migrate to native `Headers`.
- `H3Response`: Migrate to native `Response`.
- `MultiPartData`: Migrate to native `FormData`.
- `RouteNode`: Migrate to `RouterEntry`.
  `CreateRouterOptions`: Migrate to `RouterOptions`.

Removed type exports: `WebEventContext`, `NodeEventContext`, `NodePromisifiedHandler`, `AppUse`, `Stack`, `InputLayer`, `InputStack`, `Layer`, `Matcher`, `PlainHandler`, `PlainRequest`, `PlainResponse`, `WebHandler`.
