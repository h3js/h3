import { beforeEach } from "vitest";
import {
  redirect,
  withBase,
  assertMethod,
  getQuery,
  getRequestURL,
  getRequestIP,
  getRequestFingerprint,
  handleCacheHeaders,
  html,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("utils", (t, { it, describe, expect }) => {
  describe("html", () => {
    it("can return html response", async () => {
      t.app.get("/test", () => html("<h1>Hello</h1>"));
      const res1 = await t.fetch("/test");
      expect(res1.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res1.text()).toBe("<h1>Hello</h1>");

      t.app.get(
        "/test2",
        () =>
          html`
            <h1>Hello</h1>
          `,
      );
      const res2 = await t.fetch("/test2");
      expect(res2.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect((await res2.text()).trim()).toBe("<h1>Hello</h1>");
    });
  });

  describe("redirect", () => {
    it("can redirect URLs", async () => {
      t.app.use(() => redirect("https://google.com"));
      const result = await t.fetch("/");
      expect(result.headers.get("location")).toBe("https://google.com");
      expect(result.headers.get("content-type")).toBe("text/html; charset=utf-8");
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
      expect((await t.fetch("/post")).status).toBe(405);
      expect((await t.fetch("/post", { method: "POST" })).status).toBe(200);
      expect((await t.fetch("/post", { method: "HEAD" })).status).toBe(200);
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
  });
});
