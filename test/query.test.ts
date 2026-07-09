import {
  appendAcceptQuery,
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
