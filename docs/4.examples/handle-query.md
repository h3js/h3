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

## Offer a Cacheable `GET` Alternative

A `QUERY` response is not addressable by URL, so browsers and CDNs can't cache it. RFC 10008 suggests pointing clients at an equivalent, cacheable `GET` via the `Content-Location` header. Stash the result under a stable id and let a client repeat the query with an ordinary, HTTP-cacheable `GET`:

```ts
app.query("/books", async (event) => {
  const result = runQuery(type, query);
  const id = queryId(type, query); // stable hash of the query
  cache.set(id, result);
  event.res.headers.set("content-location", `/books/${id}`);
  return result;
});
```

## Full Example

A self-contained, runnable demo — a `/books` resource that accepts SQL-ish and JSONPath queries, validates the `Content-Type`, and advertises a cacheable `GET` alternative. It also serves a small interactive page at `/`.

::read-more{to="https://github.com/h3js/h3/tree/main/examples/query.mjs"}
See the full [`examples/query.mjs`](https://github.com/h3js/h3/tree/main/examples/query.mjs) source, or run it locally with `node examples/query.mjs`.
::

> [!NOTE]
> Unlike `GET`, `QUERY` is **not** CORS-safelisted, so browsers send a preflight. If you pass an explicit `methods` allowlist to [`handleCors`](/utils/security#handlecorsevent-options), include `"QUERY"`.
