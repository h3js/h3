import { beforeEach, vi } from "vitest";
import {
  redirect,
  redirectBack,
  withBase,
  assertMethod,
  getQuery,
  getRequestURL,
  getRequestHost,
  getRequestIP,
  getRequestFingerprint,
  handleCacheHeaders,
  html,
  raw,
  writeEarlyHints,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("utils", (t, { it, describe, expect }) => {
  describe("html", () => {
    it("can return html response", async () => {
      t.app.get("/test", () => html(raw("<h1>Hello</h1>")));
      const res1 = await t.fetch("/test");
      expect(res1.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res1.text()).toBe("<h1>Hello</h1>");

      t.app.get("/test2", () => html` <h1>Hello</h1> `);
      const res2 = await t.fetch("/test2");
      expect(res2.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect((await res2.text()).trim()).toBe("<h1>Hello</h1>");
    });

    it("escapes interpolated values in tagged template", async () => {
      const name = `<script>alert("xss")</script>&'`;
      t.app.get("/test", () => html`<h1>Hello, ${name}!</h1>`);
      const res = await t.fetch("/test");
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe(
        "<h1>Hello, &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&#39;!</h1>",
      );
    });

    it("passes raw() values through unescaped", async () => {
      const trusted = "<b>bold</b>";
      const user = "<script>";
      t.app.get("/test", () => html`<div>${raw(trusted)}${user}</div>`);
      const res = await t.fetch("/test");
      expect(await res.text()).toBe("<div><b>bold</b>&lt;script&gt;</div>");
    });

    it("does not treat duck-typed objects as raw values", async () => {
      const spoofed = { value: "<script>alert(1)</script>" };
      t.app.get("/test", () => html`<div>${spoofed}</div>`);
      const res = await t.fetch("/test");
      expect(await res.text()).not.toContain("<script>");
    });

    it("accepts raw() values from another h3 instance (symbol brand)", async () => {
      // Simulates raw() from a duplicated copy of h3 via the global symbol registry
      const foreignRaw = { [Symbol.for("h3.rawHTML")]: true, value: "<b>bold</b>" };
      t.app.get("/test", () => html`<div>${foreignRaw}</div>`);
      const res = await t.fetch("/test");
      expect(await res.text()).toBe("<div><b>bold</b></div>");
    });

    it("escapes plain string usage and warns once", async () => {
      (html as { _isWarned?: boolean })._isWarned = false;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        t.app.get("/test", () => html("<p>raw & <string></p>"));
        const res = await t.fetch("/test");
        expect(await res.text()).toBe("&lt;p&gt;raw &amp; &lt;string&gt;&lt;/p&gt;");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("html``");

        const res2 = await t.fetch("/test");
        expect(await res2.text()).toBe("&lt;p&gt;raw &amp; &lt;string&gt;&lt;/p&gt;");
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("does not warn for plain strings without special characters", async () => {
      (html as { _isWarned?: boolean })._isWarned = false;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        t.app.get("/test", () => html("Hello, World!"));
        const res = await t.fetch("/test");
        expect(await res.text()).toBe("Hello, World!");
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("redirect", () => {
    it("can redirect URLs", async () => {
      t.app.use(() => redirect("https://google.com"));
      const result = await t.fetch("/");
      expect(result.headers.get("location")).toBe("https://google.com");
      expect(result.headers.get("content-type")).toBe("text/html; charset=utf-8");
    });

    it("escapes special characters in HTML body", async () => {
      const malicious = 'https://example.com/"><script>alert(1)</script>&foo=bar';
      t.app.use(() => redirect(malicious));
      const result = await t.fetch("/");
      expect(result.headers.get("location")).toBe(malicious);
      const body = await result.text();
      expect(body).toBe(
        `<html><head><meta http-equiv="refresh" content="0; url=https://example.com/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;foo=bar" /></head></html>`,
      );
    });
  });

  describe("redirectBack", () => {
    it("redirects to referer pathname when same origin", async () => {
      t.app.post("/submit", (event) => redirectBack(event));
      const baseUrl = t.url || "http://localhost";
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: `${baseUrl}/form` },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/form");
    });

    it("strips query string from referer by default", async () => {
      t.app.post("/submit", (event) => redirectBack(event));
      const baseUrl = t.url || "http://localhost";
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: `${baseUrl}/page?token=secret&action=delete` },
      });
      expect(res.headers.get("location")).toBe("/page");
    });

    it("preserves query string with allowQuery", async () => {
      t.app.post("/submit", (event) => redirectBack(event, { allowQuery: true }));
      const baseUrl = t.url || "http://localhost";
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: `${baseUrl}/page?tab=settings` },
      });
      expect(res.headers.get("location")).toBe("/page?tab=settings");
    });

    it("uses fallback when referer is cross-origin", async () => {
      t.app.post("/submit", (event) => redirectBack(event, { fallback: "/home" }));
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: "https://evil.com/steal" },
      });
      expect(res.headers.get("location")).toBe("/home");
    });

    it("uses fallback when no referer", async () => {
      t.app.post("/submit", (event) => redirectBack(event, { fallback: "/dashboard" }));
      const res = await t.fetch("/submit", { method: "POST" });
      expect(res.headers.get("location")).toBe("/dashboard");
    });

    it("defaults fallback to /", async () => {
      t.app.post("/submit", (event) => redirectBack(event));
      const res = await t.fetch("/submit", { method: "POST" });
      expect(res.headers.get("location")).toBe("/");
    });

    it("prevents open redirect via protocol-relative path in referer", async () => {
      t.app.post("/submit", (event) => redirectBack(event));
      const baseUrl = t.url || "http://localhost";
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: `${baseUrl}//evil.com/steal` },
      });
      expect(res.headers.get("location")).not.toBe("//evil.com/steal");
      expect(res.headers.get("location")).toBe("/evil.com/steal");
    });

    it("uses fallback when referer is invalid URL", async () => {
      t.app.post("/submit", (event) => redirectBack(event, { fallback: "/safe" }));
      const res = await t.fetch("/submit", {
        method: "POST",
        headers: { referer: "not-a-valid-url" },
      });
      expect(res.headers.get("location")).toBe("/safe");
    });
  });

  describe("withBase", () => {
    it("can prefix routes", async () => {
      t.app.use(withBase("/api", (event) => Promise.resolve(event.path)));
      const result = await t.fetch("/api/test");

      expect(await result.text()).toBe("/test");
    });
    it("does nothing when not provided a base", async () => {
      t.app.use(withBase("", (event) => Promise.resolve(event.path)));
      const result = await t.fetch("/api/test");

      expect(await result.text()).toBe("/api/test");
    });
    it("collapses leading slashes after stripping base", async () => {
      t.app.use(withBase("/api", (event) => Promise.resolve(event.path)));
      const result = await t.fetch("/api//evil.com");

      expect(await result.text()).toBe("/evil.com");
    });
  });

  describe("getQuery", () => {
    it("can parse query params", async () => {
      t.app.get("/**", (event) => {
        const query = getQuery(event);
        expect(query).toMatchObject({
          bool: "true",
          name: "string",
          number: "1",
        });
        return "200";
      });
      const result = await t.fetch("/api/test?bool=true&name=string&number=1");

      expect(await result.text()).toBe("200");
    });
  });

  describe("getMethod", () => {
    it("can get method", async () => {
      t.app.all("/*", (event) => event.req.method);
      expect(await (await t.fetch("/api")).text()).toBe("GET");
      expect(await (await t.fetch("/api", { method: "POST" })).text()).toBe("POST");
    });
  });

  describe("getRequestHost", () => {
    it("returns host header value", async () => {
      t.app.get("/", (event) => getRequestHost(event));
      const res = await t.fetch("/");
      // In test environments, host header is set by the HTTP client
      expect(await res.text()).toBeTruthy();
    });

    it("uses x-forwarded-host when enabled", async () => {
      t.app.get("/", (event) => getRequestHost(event, { xForwardedHost: true }));
      const res = await t.fetch("/", {
        headers: { "x-forwarded-host": "proxy.example.com" },
      });
      expect(await res.text()).toBe("proxy.example.com");
    });

    it("uses first value from x-forwarded-host with multiple entries", async () => {
      t.app.get("/", (event) => getRequestHost(event, { xForwardedHost: true }));
      const res = await t.fetch("/", {
        headers: { "x-forwarded-host": "first.com, second.com" },
      });
      expect(await res.text()).toBe("first.com");
    });
  });

  describe("getRequestURL", () => {
    const tests = [
      "http://localhost/foo?bar=baz",
      "http://localhost\\foo",
      "http://localhost//foo",
      "http://localhost//foo//bar",
      "http://localhost//foo\\bar\\",
      "http://localhost///foo",
      "http://localhost\\\\foo",
      "http://localhost\\/foo",
      "http://localhost/\\foo",
      "http://example.com/test",
      "http://localhost:8080/test",
    ];

    beforeEach(() => {
      t.app.get("/**", (event) => {
        return getRequestURL(event, {
          xForwardedProto: true,
          xForwardedHost: true,
        }).href;
      });
    });

    for (const c of tests) {
      it(`getRequestURL(${JSON.stringify(c)})`, async () => {
        const res = await t.fetch(c);
        expect(await res.text()).toMatch(new URL(c).href);
      });
    }

    it("x-forwarded-host clears port for plain host", async () => {
      const res = await t
        .fetch("http://localhost:3000/test", {
          headers: { "x-forwarded-host": "example.com" },
        })
        .then((r) => r.text());
      expect(res).toBe("http://example.com/test");
    });

    it("x-forwarded-host preserves explicit port", async () => {
      const res = await t
        .fetch("http://localhost/test", {
          headers: { "x-forwarded-host": "example.com:8080" },
        })
        .then((r) => r.text());
      expect(res).toBe("http://example.com:8080/test");
    });

    it("x-forwarded-host with IPv6 clears port", async () => {
      const res = await t
        .fetch("http://localhost:3000/test", {
          headers: { "x-forwarded-host": "[2001:db8::1]" },
        })
        .then((r) => r.text());
      expect(res).toBe("http://[2001:db8::1]/test");
    });

    it("x-forwarded-host with IPv6 and port preserves port", async () => {
      const res = await t
        .fetch("http://localhost/test", {
          headers: { "x-forwarded-host": "[2001:db8::1]:8080" },
        })
        .then((r) => r.text());
      expect(res).toBe("http://[2001:db8::1]:8080/test");
    });

    it('x-forwarded-proto: "https"', async () => {
      expect(
        await t
          .fetch("/", {
            headers: {
              "x-forwarded-proto": "https",
            },
          })
          .then((r) => r.text()),
      ).toMatch("https://localhost");

      // TODO
      // expect(
      //   await t
      //     .fetch("https://localhost/", {
      //       headers: {
      //         "x-forwarded-proto": "http",
      //       },
      //     })
      //     .then((r) => r.text()),
      // ).toMatch("http://localhost/");
    });

    it("x-forwarded-proto comma list uses first entry", async () => {
      const res = await t
        .fetch("http://localhost/test", {
          headers: { "x-forwarded-proto": "https,http" },
        })
        .then((r) => r.text());
      expect(res).toMatch(/^https:\/\//);
    });

    it("x-forwarded-proto comma list with spaces uses first entry trimmed", async () => {
      const res = await t
        .fetch("http://localhost/test", {
          headers: { "x-forwarded-proto": "https, http" },
        })
        .then((r) => r.text());
      expect(res).toMatch(/^https:\/\//);
    });
  });

  describe("getRequestIP", () => {
    it("x-forwarded-for", async () => {
      t.app.get("/", (event) => {
        return getRequestIP(event, {
          xForwardedFor: true,
        });
      });
      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "127.0.0.1",
        },
      });
      expect(await res.text()).toBe("127.0.0.1");
    });
    it("ports", async () => {
      t.app.get("/", (event) => {
        return getRequestIP(event, {
          xForwardedFor: true,
        });
      });
      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "127.0.0.1:1234",
        },
      });
      expect(await res.text()).toBe("127.0.0.1:1234");
    });
    it("ipv6", async () => {
      t.app.get("/", (event) => {
        return getRequestIP(event, {
          xForwardedFor: true,
        });
      });
      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        },
      });
      expect(await res.text()).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    });
    it("multiple ips", async () => {
      t.app.get("/", (event) => {
        return getRequestIP(event, {
          xForwardedFor: true,
        });
      });
      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "client , proxy1, proxy2",
        },
      });
      expect(await res.text()).toBe("client");
    });
  });

  describe("getRequestFingerprint", () => {
    it("returns an hash", async () => {
      t.app.use((event) => getRequestFingerprint(event, { xForwardedFor: true }));

      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "client-ip",
        },
      });
      const fingerprint = await res.text();

      // sha1 is 40 chars long
      expect(fingerprint).toHaveLength(40);

      // and only uses hex chars
      expect(fingerprint).toMatch(/^[\dA-Fa-f]+$/);
    });

    it("returns the same hash every time for same request", async () => {
      t.app.use((event) => getRequestFingerprint(event, { hash: false, xForwardedFor: true }));
      for (let i = 0; i < 3; i++) {
        const res = await t.fetch("/", {
          headers: {
            "x-forwarded-for": "client-ip",
          },
        });
        expect(await res.text()).toBe("client-ip");
      }
    });

    it("returns null when all detections impossible", async () => {
      t.app.use((event) => getRequestFingerprint(event, { hash: false, ip: false }));
      expect(await (await t.fetch("/")).text()).toBe("");
    });

    it("can use path/method", async () => {
      t.app.use((event) =>
        getRequestFingerprint(event, {
          hash: false,
          ip: false,
          url: true,
          method: true,
        }),
      );

      const res = await t.fetch("/foo", { method: "POST" });

      expect(await res.text()).toMatch(/^POST\|http.+\/foo$/);
    });

    it("uses user agent when available", async () => {
      t.app.use((event) =>
        getRequestFingerprint(event, {
          hash: false,
          userAgent: true,
          xForwardedFor: true,
        }),
      );

      const res = await t.fetch("/", {
        headers: {
          "user-agent": "test-user-agent",
          "x-forwarded-for": "client-ip",
        },
      });

      expect(await res.text()).toBe("client-ip|test-user-agent");
    });

    it("uses x-forwarded-for ip when header set", async () => {
      t.app.use((event) => getRequestFingerprint(event, { hash: false, xForwardedFor: true }));

      const res = await t.fetch("/", {
        headers: {
          "x-forwarded-for": "x-forwarded-for",
        },
      });

      expect(await res.text()).toBe("x-forwarded-for");
    });

    it("uses the request ip when no x-forwarded-for header set", async () => {
      t.app.use((event) => {
        Object.defineProperty(event.node?.req.socket || {}, "remoteAddress", {
          get(): any {
            return "0.0.0.0";
          },
        });
      });

      t.app.use((event) => getRequestFingerprint(event, { hash: false }));

      const res = await t.fetch("/");

      if (t.target !== "web") {
        expect(await res.text()).toMatch(/^0\.0\.0\.0|::1$/);
      }
    });
  });

  describe("assertMethod", () => {
    it("only allow head and post", async () => {
      t.app.all("/post", (event) => {
        assertMethod(event, "POST", true);
        return "ok";
      });
      const res405 = await t.fetch("/post");
      expect(res405.status).toBe(405);
      expect(new Set(res405.headers.get("Allow")?.split(/\s*,\s*/))).toEqual(
        new Set(["POST", "HEAD"]),
      );
      expect((await t.fetch("/post", { method: "POST" })).status).toBe(200);
      expect((await t.fetch("/post", { method: "HEAD" })).status).toBe(200);
    });

    it("sets Allow header with multiple expected methods", async () => {
      t.app.all("/multi", (event) => {
        assertMethod(event, ["GET", "POST"]);
        return "ok";
      });
      const res405 = await t.fetch("/multi", { method: "DELETE" });
      expect(res405.status).toBe(405);
      expect(new Set(res405.headers.get("Allow")?.split(/\s*,\s*/))).toEqual(
        new Set(["GET", "POST"]),
      );
    });
  });

  describe("writeEarlyHints", () => {
    // In Node.js, native writeEarlyHints sends 103 Early Hints status,
    // so the Link header fallback is not used. Test fallback in web target only.
    it.skipIf(t.target === "node")(
      "sets Link header as fallback when native early hints not available",
      async () => {
        t.app.get("/", async (event) => {
          await writeEarlyHints(event, {
            Link: "</style.css>; rel=preload; as=style",
          });
          return "ok";
        });
        t.app.get("/multi", async (event) => {
          await writeEarlyHints(event, {
            Link: ["</style.css>; rel=preload; as=style", "</script.js>; rel=preload; as=script"],
          });
          return "ok";
        });

        const res = await t.fetch("/");
        expect(res.headers.get("Link")).toBe("</style.css>; rel=preload; as=style");

        const res2 = await t.fetch("/multi");
        expect(res2.headers.get("Link")).toBe(
          "</style.css>; rel=preload; as=style, </script.js>; rel=preload; as=script",
        );
      },
    );

    // Empty/falsy link values must be dropped on the fallback path too, so no
    // malformed empty `Link:` header is emitted (matches the Node path filter).
    it.skipIf(t.target === "node")(
      "does not set an empty Link header for falsy link values (fallback)",
      async () => {
        t.app.get("/empty-string", async (event) => {
          await writeEarlyHints(event, { link: "" });
          return "ok";
        });
        t.app.get("/mixed", async (event) => {
          await writeEarlyHints(event, { link: ["", "</a.css>; rel=preload; as=style"] });
          return "ok";
        });

        const res = await t.fetch("/empty-string");
        expect(res.headers.get("Link")).toBe(null);

        const res2 = await t.fetch("/mixed");
        expect(res2.headers.get("Link")).toBe("</a.css>; rel=preload; as=style");
      },
    );

    // Regression tests for #1383: on the Node.js native path, writeEarlyHints
    // returns without invoking its callback when the resolved `link` value is
    // missing/empty. h3 wraps that callback in a promise, so a missing callback
    // left the promise (and the request) hanging forever. These run in both web
    // and node targets; the node target is what actually exercises the fix.
    // Each handler races writeEarlyHints against a short timer and reports the
    // winner, so a hang surfaces as "timeout" instead of an assertion pass.
    const raceEarlyHints = async (
      event: Parameters<typeof writeEarlyHints>[0],
      hints: Parameters<typeof writeEarlyHints>[1],
    ) => {
      let timer: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        Promise.resolve(writeEarlyHints(event, hints)).then(() => "resolved" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), 500);
        }),
      ]);
      clearTimeout(timer!);
      return result;
    };

    it("resolves promptly instead of hanging with empty hints (#1383)", async () => {
      t.app.get("/", (event) => raceEarlyHints(event, {}));
      const res = await t.fetch("/");
      expect(await res.text()).toBe("resolved");
    });

    it("resolves promptly when the link hint value is empty", async () => {
      t.app.get("/empty-string", (event) => raceEarlyHints(event, { link: "" }));
      t.app.get("/empty-array", (event) => raceEarlyHints(event, { Link: [] }));

      expect(await (await t.fetch("/empty-string")).text()).toBe("resolved");
      expect(await (await t.fetch("/empty-array")).text()).toBe("resolved");
    });

    it("resolves when only a capital-cased Link key is provided", async () => {
      t.app.get("/", (event) =>
        raceEarlyHints(event, { Link: "</style.css>; rel=preload; as=style" }),
      );
      const res = await t.fetch("/");
      expect(await res.text()).toBe("resolved");
    });

    it("merges both link and Link keys without dropping values", async () => {
      t.app.get("/", (event) =>
        raceEarlyHints(event, {
          link: "</a.css>; rel=preload; as=style",
          Link: "</b.js>; rel=preload; as=script",
        }),
      );
      const res = await t.fetch("/");
      expect(await res.text()).toBe("resolved");
      // On the web fallback path both values are merged onto the `link` header.
      if (t.target === "web") {
        expect(res.headers.get("Link")).toBe(
          "</a.css>; rel=preload; as=style, </b.js>; rel=preload; as=script",
        );
      }
    });
  });

  describe("handleCacheHeaders", () => {
    it("can handle cache headers", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          modifiedTime: new Date("2021-01-01"),
        });
        return "ok";
      });
      const res = await t.fetch("/");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(res.headers.get("last-modified")).toBe("Fri, 01 Jan 2021 00:00:00 GMT");
      expect(await res.text()).toBe("ok");
    });

    it("can handle cache headers with etag", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          etag: "123",
        });
        return "ok";
      });
      const res = await t.fetch("/");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(res.headers.get("etag")).toBe("123");
      expect(await res.text()).toBe("ok");
    });

    it("can handle cache headers with if-none-match", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          etag: "123",
        });
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: {
          "if-none-match": "123",
        },
      });
      expect(res.status).toBe(304);
    });

    it("can handle cache headers with if-modified-since", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          modifiedTime: new Date("2021-01-01"),
        });
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: {
          "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
        },
      });
      expect(res.status).toBe(304);
    });

    it("returns 304 when if-none-match is a comma-separated list containing the etag", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          etag: '"v2"',
        });
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: {
          // RFC 7232 §3.2: the field-value is a list of entity-tags
          "if-none-match": '"v1", "v2"',
        },
      });
      expect(res.status).toBe(304);
    });

    it("handles modifiedTime with milliseconds correctly", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          modifiedTime: new Date("2021-01-01T00:00:00.500Z"),
        });
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: {
          "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
        },
      });
      expect(res.status).toBe(304);
    });

    it("does not force `public` when explicit cacheControls are provided (#1442, #1453)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          cacheControls: ["private"],
        });
        return "ok";
      });
      const res = await t.fetch("/");
      // `private` responses must not carry the shared-cache `s-maxage` directive (#1454).
      expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    });

    it("keeps `public` when explicit cacheControls do not set visibility (#1454)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          cacheControls: ["must-revalidate"],
        });
        return "ok";
      });
      // A shared cache needs `public` to store authenticated responses (RFC 9111 §3.5),
      // so it must survive alongside non-visibility directives like `must-revalidate`.
      const res = await t.fetch("/");
      expect(res.headers.get("cache-control")).toBe("public, must-revalidate");
    });

    it("omits `s-maxage` when `no-store` is set (#1454)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          cacheControls: ["no-store"],
        });
        return "ok";
      });
      const res = await t.fetch("/");
      expect(res.headers.get("cache-control")).toBe("no-store, max-age=60");
    });

    it("treats an empty `if-none-match` as absent so `if-modified-since` still applies (#1454)", async () => {
      t.app.use((event) => {
        if (
          handleCacheHeaders(event, {
            modifiedTime: new Date("2021-01-01"),
          })
        ) {
          return null;
        }
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: {
          "if-none-match": "",
          "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
        },
      });
      expect(res.status).toBe(304);
    });

    it("ignores if-modified-since when if-none-match is present (RFC 9110 §13.1.3, #1453)", async () => {
      t.app.use((event) => {
        if (
          handleCacheHeaders(event, {
            etag: '"v2"',
            modifiedTime: new Date("2021-01-01"),
          })
        ) {
          return null;
        }
        return "ok";
      });
      // The ETag does not match, so If-Modified-Since must be ignored and a 200
      // returned even though the resource was not modified since that date.
      const res = await t.fetch("/", {
        headers: {
          "if-none-match": '"v1"',
          "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("matches etag using weak comparison and wildcard (#1453)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, { etag: '"v2"' });
        return "ok";
      });
      const weak = await t.fetch("/", {
        headers: { "if-none-match": 'W/"v2"' },
      });
      expect(weak.status).toBe(304);

      const wildcard = await t.fetch("/", {
        headers: { "if-none-match": "*" },
      });
      expect(wildcard.status).toBe(304);
    });

    it("detects `private` when bundled into a single cacheControls entry (#1454)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, {
          maxAge: 60,
          cacheControls: ["max-age=30, private"],
        });
        return "ok";
      });
      // A combined directive string must still be recognized as private so no
      // contradictory `public`/`s-maxage` is added for a personalized response.
      const res = await t.fetch("/");
      expect(res.headers.get("cache-control")).toBe("max-age=30, private, max-age=60");
    });

    it("matches a quoted etag whose value contains a comma (#1454)", async () => {
      t.app.use((event) => {
        handleCacheHeaders(event, { etag: '"a,b"' });
        return "ok";
      });
      const res = await t.fetch("/", {
        headers: { "if-none-match": '"a,b"' },
      });
      expect(res.status).toBe(304);
    });
  });
});
