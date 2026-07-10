---
icon: ph:arrow-right
---

# HTTP `QUERY` Method

> Accept safe, cacheable requests that carry a query in the body.

The [HTTP `QUERY` method (RFC 10008)](https://www.rfc-editor.org/rfc/rfc10008) is like `GET` — **safe, idempotent, and cacheable** — but carries a query in the request **body** with a `Content-Type`. It's the standard answer to "I need a GET, but my query is too large or too structured for the URL".

H3 supports `QUERY` as a first-class method via [`app.query()`](/guide/basics/routing#http-query-method), a high-level [`defineQueryHandler`](#define-a-query-handler) factory, and two lower-level helper utilities.

## Define a `QUERY` Handler

[`defineQueryHandler`](/utils/request#definequeryhandlerdef) captures the whole RFC 10008 ceremony: declare the accepted query `formats`, and it advertises them via `Accept-Query` on every response (including errors), validates the request `Content-Type` (`400`/`415`/`422`, plus `405` for non-`QUERY` methods), and passes the matched media type to the handler as `format`:

```ts
import { defineQueryHandler, readBody } from "h3";

app.query(
  "/books",
  defineQueryHandler({
    formats: ["application/sql", "application/jsonpath"],
    handler: async (event, { format }) => {
      const query = await readBody(event, { type: "text" });
      return runQuery(format, query);
    },
  }),
);
```

Formats may use wildcards (`application/*`, `*/*`) — `format` is always the concrete request media type. The sections below show the lower-level utilities it builds on, for when you need custom behavior.

## Offer a Cacheable `GET` Equivalent

A `QUERY` response is not URL-addressable (and content-keyed `QUERY` caching is not deployed in practice), so browsers and CDNs won't reuse it. RFC 10008 (§2.3) suggests advertising an equivalent, cacheable `GET` via the `Content-Location` header. Pass `get` to `defineQueryHandler` — the _same_ handler serves the advertised `GET`, so no server-side result store is needed:

```ts
const searchBooks = defineQueryHandler({
  formats: ["application/sql", "application/jsonpath"],
  get: "q",
  handler: (event, { format, query }) => runQuery(format, query),
});

// The handler gates the method itself, so one `all` route serves QUERY/GET/HEAD.
app.all("/books", searchBooks);
// QUERY /books     -> 200 + Content-Location: /books?q=<query>&format=<format>
// GET /books?q=... -> same result, ordinary HTTP caching applies
```

With `get` set, the handler receives the resolved `query` in its context on both paths (read from the body on `QUERY`, from the URL param on `GET`/`HEAD`). On `GET`, the format comes from `?format=` (customizable via `get: { param, formatParam }`) and may be omitted when exactly one concrete format is accepted; rejections on the `GET` path are `400`. `Content-Location` preserves the request's existing search params and is skipped when the equivalent URL would exceed 2048 characters — very long queries are the reason `QUERY` exists. `HEAD` is served as the bodiless form of the cacheable `GET` ([RFC 9110 §9.3.2](https://www.rfc-editor.org/rfc/rfc9110#section-9.3.2) — there is no HEAD-of-`QUERY`), so it works only when `get` is set. Registering with `app.all` covers all three and returns `405 Method Not Allowed` (with an `Allow` header) for any other method — the handler enforces the allowed verbs itself, so you don't wire up per-method routes.

## Register a `QUERY` Handler

Read the request body just like you would for a `POST`:

```ts
import { readBody } from "h3";

app.query("/books", async (event) => {
  const query = await readBody(event, { type: "text" });
  return runSearch(query);
});
```

Because `QUERY` carries an attacker-controllable body, [body-size limits](/utils/request#assertbodysizeevent-limit) apply just like `POST`.

## Advertise Accepted Formats

Use [`appendAcceptQuery`](/utils/request#appendacceptqueryevent-mediatypes) to tell clients which query formats a resource understands. It sets the `Accept-Query` response header (a [Structured Fields](https://www.rfc-editor.org/rfc/rfc8941) List), and can be set on a plain `GET` too so clients can discover formats before sending a `QUERY`:

```ts
import { appendAcceptQuery } from "h3";

app.get("/books", (event) => {
  appendAcceptQuery(event, ["application/sql", "application/jsonpath"]);
  // Accept-Query: application/sql, application/jsonpath
  return "Send a QUERY request with a SQL or JSONPath body.";
});
```

## Validate the `Content-Type`

Use [`requireContentType`](/utils/request#requirecontenttypeevent-acceptedtypes) to enforce the RFC's error semantics. It returns the matched media type, or throws `400` (missing), `415` (unsupported), or `422` (malformed):

```ts
import { requireContentType, readBody } from "h3";

app.query("/books", async (event) => {
  const type = requireContentType(event, ["application/sql", "application/jsonpath"]);
  const query = await readBody(event, { type: "text" });
  return runQuery(type, query);
});
```

## Full Example

A self-contained, runnable demo — a `/books` resource that accepts SQL-ish and JSONPath queries, validates the `Content-Type`, and advertises a cacheable `GET` alternative. It also serves a small interactive page at `/`.

::read-more{to="https://github.com/h3js/h3/tree/main/examples/query.mjs"}
See the full [`examples/query.mjs`](https://github.com/h3js/h3/tree/main/examples/query.mjs) source, or run it locally with `node examples/query.mjs`.
::

> [!NOTE]
> Unlike `GET`, `QUERY` is **not** CORS-safelisted, so browsers send a preflight. If you pass an explicit `methods` allowlist to [`handleCors`](/utils/security#handlecorsevent-options), include `"QUERY"`.
