import {
  appendAcceptQuery,
  defineQueryHandler,
  handleCacheHeaders,
  handleCors,
  requireContentType,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("query utils", (t, { it, expect, describe }) => {
  describe("appendAcceptQuery", () => {
    it("serializes media types as a structured fields list", async () => {
      t.app.query("/search", (event) => {
        appendAcceptQuery(event, ["application/sql;charset=UTF-8", "application/jsonpath"]);
        return "ok";
      });
      const res = await t.fetch("/search", { method: "QUERY" });
      expect(res.headers.get("accept-query")).toBe(
        'application/sql;charset="UTF-8", application/jsonpath',
      );
    });

    it("accepts a single media type string", async () => {
      t.app.query("/one", (event) => {
        appendAcceptQuery(event, "application/jsonpath");
        return "ok";
      });
      const res = await t.fetch("/one", { method: "QUERY" });
      expect(res.headers.get("accept-query")).toBe("application/jsonpath");
    });

    it("normalizes already-quoted parameter values", async () => {
      t.app.query("/quoted", (event) => {
        appendAcceptQuery(event, 'application/sql;charset="UTF-8"');
        return "ok";
      });
      const res = await t.fetch("/quoted", { method: "QUERY" });
      expect(res.headers.get("accept-query")).toBe('application/sql;charset="UTF-8"');
    });

    it("does not set the header for an empty list", async () => {
      t.app.query("/none", (event) => {
        appendAcceptQuery(event, []);
        return "ok";
      });
      const res = await t.fetch("/none", { method: "QUERY" });
      expect(res.headers.has("accept-query")).toBe(false);
    });

    it("escapes quotes and backslashes in parameter values", async () => {
      t.app.query("/escape", (event) => {
        appendAcceptQuery(event, 'application/sql;note=a "b" \\c');
        return "ok";
      });
      const res = await t.fetch("/escape", { method: "QUERY" });
      expect(res.headers.get("accept-query")).toBe('application/sql;note="a \\"b\\" \\\\c"');
    });

    it("throws on an invalid media type token", async () => {
      t.app.query("/invalid", (event) => {
        expect(() => appendAcceptQuery(event, "not a token")).toThrow(TypeError);
        return "ok";
      });
      await t.fetch("/invalid", { method: "QUERY" });
    });

    it("accumulates formats across multiple calls instead of overwriting", async () => {
      t.app.query("/accumulate", (event) => {
        appendAcceptQuery(event, "application/jsonpath");
        appendAcceptQuery(event, "application/sql");
        return "ok";
      });
      const res = await t.fetch("/accumulate", { method: "QUERY" });
      expect(res.headers.get("accept-query")).toBe("application/jsonpath, application/sql");
    });
  });

  describe("requireContentType", () => {
    it("passes and returns the matched media type", async () => {
      t.app.query("/typed", (event) => {
        return requireContentType(event, ["application/sql", "application/jsonpath"]);
      });
      const res = await t.fetch("/typed", {
        method: "QUERY",
        body: "SELECT 1",
        headers: { "content-type": "application/sql; charset=utf-8" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("application/sql");
    });

    it("throws 400 when Content-Type is missing", async () => {
      t.app.query("/missing", (event) => requireContentType(event, "application/sql"));
      const res = await t.fetch("/missing", { method: "QUERY" });
      expect(res.status).toBe(400);
    });

    it("matches an accepted type that carries parameters", async () => {
      t.app.query("/paramized", (event) => {
        return requireContentType(event, "application/json; charset=utf-8");
      });
      const res = await t.fetch("/paramized", {
        method: "QUERY",
        body: "{}",
        headers: { "content-type": "application/json; charset=utf-8" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("application/json");
    });

    it("throws 415 for an unsupported media type", async () => {
      t.app.query("/unsupported", (event) => requireContentType(event, "application/sql"));
      const res = await t.fetch("/unsupported", {
        method: "QUERY",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(415);
    });

    it("throws 422 for a malformed Content-Type", async () => {
      t.app.query("/malformed", (event) => requireContentType(event, "application/sql"));
      const res = await t.fetch("/malformed", {
        method: "QUERY",
        body: "x",
        headers: { "content-type": "nonsense" },
      });
      expect(res.status).toBe(422);
    });

    it("throws 422 for a Content-Type with an empty subtype", async () => {
      t.app.query("/emptysub", (event) => requireContentType(event, "application/sql"));
      const res = await t.fetch("/emptysub", {
        method: "QUERY",
        body: "x",
        headers: { "content-type": "application/" },
      });
      expect(res.status).toBe(422);
    });

    it("supports wildcard subtypes", async () => {
      t.app.query("/wildcard", (event) => requireContentType(event, "application/*"));
      const res = await t.fetch("/wildcard", {
        method: "QUERY",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
    });

    it("supports the */* wildcard", async () => {
      t.app.query("/any", (event) => requireContentType(event, "*/*"));
      const res = await t.fetch("/any", {
        method: "QUERY",
        body: "x",
        headers: { "content-type": "text/plain" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("defineQueryHandler", () => {
    const booksHandler = () =>
      defineQueryHandler({
        formats: ["application/sql", "application/jsonpath"],
        handler: async (event, { format }) => ({ format, query: await event.req.text() }),
      });

    it("passes the matched format and lets the handler read the query body", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "$[?(@.year==2015)]",
        headers: { "content-type": "application/jsonpath" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        format: "application/jsonpath",
        query: "$[?(@.year==2015)]",
      });
    });

    it("matches a Content-Type that carries parameters", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "SELECT 1",
        headers: { "content-type": "application/sql; charset=utf-8" },
      });
      expect(await res.json()).toEqual({ format: "application/sql", query: "SELECT 1" });
    });

    it("supports wildcard formats and reports the concrete request format", async () => {
      t.app.query(
        "/books",
        defineQueryHandler({
          formats: ["application/*"],
          handler: (_event, { format }) => format,
        }),
      );
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "$",
        headers: { "content-type": "application/jsonpath" },
      });
      expect(await res.text()).toBe("application/jsonpath");
    });

    it("advertises Accept-Query on success responses", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "SELECT 1",
        headers: { "content-type": "application/sql" },
      });
      expect(res.headers.get("accept-query")).toBe("application/sql, application/jsonpath");
    });

    it("rejects an unsupported format with 415 and still advertises Accept-Query", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(415);
      expect(res.headers.get("accept-query")).toBe("application/sql, application/jsonpath");
    });

    it("rejects a missing Content-Type with 400", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", { method: "QUERY" });
      expect(res.status).toBe(400);
    });

    it("rejects a malformed Content-Type with 422", async () => {
      t.app.query("/books", booksHandler());
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "x",
        headers: { "content-type": "nonsense" },
      });
      expect(res.status).toBe(422);
    });

    it("rejects non-QUERY methods with 405, Allow and Accept-Query", async () => {
      t.app.all("/books", booksHandler());
      const res = await t.fetch("/books");
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("QUERY");
      expect(res.headers.get("accept-query")).toBe("application/sql, application/jsonpath");
    });

    it("matches a format that carries parameters", async () => {
      t.app.query(
        "/books",
        defineQueryHandler({
          formats: ["application/SQL; charset=UTF-8"],
          handler: (_event, { format }) => format,
        }),
      );
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "SELECT 1",
        headers: { "content-type": "application/sql" },
      });
      expect(await res.text()).toBe("application/sql");
      expect(res.headers.get("accept-query")).toBe('application/SQL;charset="UTF-8"');
    });

    it("runs the middleware option before the handler", async () => {
      t.app.query(
        "/books",
        defineQueryHandler({
          middleware: [
            (event, next) => {
              event.res.headers.set("x-middleware", "1");
              return next();
            },
          ],
          formats: ["application/sql"],
          handler: () => "ok",
        }),
      );
      const res = await t.fetch("/books", {
        method: "QUERY",
        body: "SELECT 1",
        headers: { "content-type": "application/sql" },
      });
      expect(res.headers.get("x-middleware")).toBe("1");
    });

    describe("get equivalence", () => {
      const searchHandler = () =>
        defineQueryHandler({
          formats: ["application/sql", "application/jsonpath"],
          get: "q",
          handler: (event, { format, query }) => ({ method: event.req.method, format, query }),
        });

      it("advertises the equivalent GET via Content-Location and serves it identically", async () => {
        const h = searchHandler();
        t.app.get("/books", h).query("/books", h);
        const queryRes = await t.fetch("/books", {
          method: "QUERY",
          body: "SELECT * FROM books WHERE author = 'a & b + c'",
          headers: { "content-type": "application/sql" },
        });
        expect(queryRes.status).toBe(200);
        const location = queryRes.headers.get("content-location")!;
        expect(location).toBe(
          "/books?q=SELECT+*+FROM+books+WHERE+author+%3D+%27a+%26+b+%2B+c%27&format=application%2Fsql",
        );
        const getRes = await t.fetch(location);
        expect(getRes.status).toBe(200);
        const [queryBody, getBody] = [await queryRes.json(), await getRes.json()];
        expect(getBody).toEqual({ ...queryBody, method: "GET" });
        expect(queryBody.query).toBe("SELECT * FROM books WHERE author = 'a & b + c'");
      });

      it("preserves existing search params in Content-Location", async () => {
        t.app.query("/books", searchHandler());
        const res = await t.fetch("/books?lang=en&q=stale", {
          method: "QUERY",
          body: "SELECT 1",
          headers: { "content-type": "application/sql" },
        });
        const location = new URLSearchParams(res.headers.get("content-location")!.split("?")[1]);
        expect(location.get("lang")).toBe("en");
        expect(location.get("q")).toBe("SELECT 1");
        expect(location.get("format")).toBe("application/sql");
      });

      it("passes the query read from the body on the QUERY path", async () => {
        t.app.query("/books", searchHandler());
        const res = await t.fetch("/books", {
          method: "QUERY",
          body: "$[?(@.year==2015)]",
          headers: { "content-type": "application/jsonpath" },
        });
        expect(await res.json()).toEqual({
          method: "QUERY",
          format: "application/jsonpath",
          query: "$[?(@.year==2015)]",
        });
      });

      it("rejects a GET without the query param with 400", async () => {
        t.app.get("/books", searchHandler());
        const res = await t.fetch("/books");
        expect(res.status).toBe(400);
        expect(res.headers.get("accept-query")).toBe("application/sql, application/jsonpath");
      });

      it("rejects a GET with an unsupported format param with 400", async () => {
        t.app.get("/books", searchHandler());
        const res = await t.fetch("/books?q=SELECT+1&format=text/plain");
        expect(res.status).toBe(400);
      });

      it("rejects an ambiguous GET (multiple formats, no format param) with 400", async () => {
        t.app.get("/books", searchHandler());
        const res = await t.fetch("/books?q=SELECT+1");
        expect(res.status).toBe(400);
      });

      it("defaults the format on GET for a single concrete format and omits it from Content-Location", async () => {
        const h = defineQueryHandler({
          formats: ["application/sql"],
          get: "q",
          handler: (_event, { format, query }) => ({ format, query }),
        });
        t.app.get("/books", h).query("/books", h);
        const getRes = await t.fetch("/books?q=SELECT+1");
        expect(await getRes.json()).toEqual({ format: "application/sql", query: "SELECT 1" });
        const queryRes = await t.fetch("/books", {
          method: "QUERY",
          body: "SELECT 1",
          headers: { "content-type": "application/sql" },
        });
        expect(queryRes.headers.get("content-location")).toBe("/books?q=SELECT+1");
      });

      it("requires the format param on GET for a single wildcard format", async () => {
        t.app.get(
          "/books",
          defineQueryHandler({
            formats: ["application/*"],
            get: "q",
            handler: (_event, { format }) => format,
          }),
        );
        const missing = await t.fetch("/books?q=x");
        expect(missing.status).toBe(400);
        const res = await t.fetch("/books?q=x&format=application/jsonpath");
        expect(await res.text()).toBe("application/jsonpath");
      });

      it("supports custom param names via the object form", async () => {
        t.app.get(
          "/books",
          defineQueryHandler({
            formats: ["application/sql", "application/jsonpath"],
            get: { param: "query", formatParam: "as" },
            handler: (_event, { format, query }) => ({ format, query }),
          }),
        );
        const res = await t.fetch("/books?query=SELECT+1&as=application/sql");
        expect(await res.json()).toEqual({ format: "application/sql", query: "SELECT 1" });
      });

      it("skips Content-Location when the equivalent GET URL would be too long", async () => {
        t.app.query("/books", searchHandler());
        const res = await t.fetch("/books", {
          method: "QUERY",
          body: `SELECT ${"x".repeat(3000)}`,
          headers: { "content-type": "application/sql" },
        });
        expect(res.status).toBe(200);
        expect(res.headers.has("content-location")).toBe(false);
      });

      it("does not set Content-Location on the GET path", async () => {
        t.app.get("/books", searchHandler());
        const res = await t.fetch("/books?q=SELECT+1&format=application/sql");
        expect(res.status).toBe(200);
        expect(res.headers.has("content-location")).toBe(false);
      });

      it("serves HEAD requests via the GET route with an empty body", async () => {
        const h = searchHandler();
        t.app.get("/books", h).query("/books", h);
        const res = await t.fetch("/books?q=SELECT+1&format=application/sql", {
          method: "HEAD",
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/application\/json/);
        expect(await res.text()).toBe("");
      });

      it("rejects other methods with 405 and Allow: GET, HEAD, QUERY", async () => {
        t.app.all("/books", searchHandler());
        const res = await t.fetch("/books", { method: "POST", body: "x" });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD, QUERY");
      });
    });

    it("throws at definition time for an empty formats list", () => {
      expect(() => defineQueryHandler({ formats: [], handler: () => "" })).toThrow(TypeError);
    });

    it("throws at definition time for an invalid media type", () => {
      expect(() => defineQueryHandler({ formats: ["not a token"], handler: () => "" })).toThrow(
        TypeError,
      );
    });
  });

  // QUERY is not a CORS-safelisted method, so browsers preflight it.
  // h3's CORS is method-agnostic, so no special handling is needed — these
  // tests guard that a QUERY preflight keeps working like any other method.
  describe("CORS preflight", () => {
    it("allows a QUERY preflight with the default wildcard methods", async () => {
      t.app.all("/search", (event) => {
        const cors = handleCors(event, { origin: "*" });
        if (cors !== false) return cors;
        return "ok";
      });
      const res = await t.fetch("/search", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "QUERY",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-methods")).toBe("*");
    });

    it("echoes QUERY in an explicit methods allowlist", async () => {
      t.app.all("/search", (event) => {
        const cors = handleCors(event, {
          origin: ["https://example.com"],
          methods: ["GET", "QUERY"],
        });
        if (cors !== false) return cors;
        return "ok";
      });
      const res = await t.fetch("/search", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "QUERY",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-methods")).toBe("GET,QUERY");
    });
  });

  // QUERY is safe, idempotent, and cacheable like GET (RFC 10008 §2), so
  // conditional-request handling must apply to it. handleCacheHeaders is not
  // method-gated — these tests guard that it stays that way for QUERY.
  describe("conditional caching", () => {
    it("returns 304 for a QUERY request matching If-None-Match", async () => {
      t.app.query("/search", (event) => {
        if (handleCacheHeaders(event, { etag: '"v1"' })) return null;
        return "results";
      });
      const res = await t.fetch("/search", {
        method: "QUERY",
        headers: { "if-none-match": '"v1"' },
      });
      expect(res.status).toBe(304);
    });

    it("returns 304 for a QUERY request matching If-Modified-Since", async () => {
      t.app.query("/search", (event) => {
        if (handleCacheHeaders(event, { modifiedTime: new Date("2021-01-01") })) return null;
        return "results";
      });
      const res = await t.fetch("/search", {
        method: "QUERY",
        headers: { "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT" },
      });
      expect(res.status).toBe(304);
    });
  });
});
