import {
  getCookie,
  parseCookies,
  setCookie,
  deleteCookie,
  getChunkedCookie,
  setChunkedCookie,
  deleteChunkedCookie,
  getValidatedCookies,
} from "../src/utils/cookie.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("cookies", (t, { it, expect, describe }) => {
  describe("parseCookies", () => {
    it("can parse cookies", async () => {
      t.app.get("/", (event) => {
        const cookies = parseCookies(event);
        expect(cookies).toEqual({ Authorization: "1234567" });
        return "200";
      });

      const result = await t.fetch("/", {
        headers: {
          Cookie: "Authorization=1234567",
        },
      });

      expect(await result.text()).toBe("200");
    });

    it("can parse empty cookies", async () => {
      t.app.get("/", (event) => {
        const cookies = parseCookies(event);
        expect(cookies).toEqual({});
        return "200";
      });

      const result = await t.fetch("/");

      expect(await result.text()).toBe("200");
    });

    it("can parse multiple cookies", async () => {
      t.app.get("/", (event) => {
        const cookies = parseCookies(event);
        expect(cookies).toEqual({
          session: "abc",
          theme: "dark",
          lang: "en",
        });
        return "200";
      });

      const result = await t.fetch("/", {
        headers: {
          Cookie: "session=abc; theme=dark; lang=en",
        },
      });

      expect(await result.text()).toBe("200");
    });
  });

  describe("getCookie", () => {
    it("can parse cookie with name", async () => {
      t.app.get("/", (event) => {
        const authorization = getCookie(event, "Authorization");
        expect(authorization).toEqual("1234567");
        return "200";
      });

      const result = await t.fetch("/", {
        headers: {
          Cookie: "Authorization=1234567",
        },
      });

      expect(await result.text()).toBe("200");
    });

    it("returns undefined for missing cookie", async () => {
      t.app.get("/", (event) => {
        const value = getCookie(event, "missing");
        expect(value).toBeUndefined();
        return "200";
      });

      const result = await t.fetch("/");
      expect(await result.text()).toBe("200");
    });
  });

  describe("setCookie", () => {
    it("can set-cookie with setCookie", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "Authorization", "1234567", {});
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual(["Authorization=1234567; Path=/"]);
      expect(await result.text()).toBe("200");
    });

    it("can set cookies with the same name but different serializeOptions", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "Authorization", "1234567", {
          domain: "example1.test",
        });
        setCookie(event, "Authorization", "7654321", {
          domain: "example2.test",
        });
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual([
        "Authorization=1234567; Domain=example1.test; Path=/",
        "Authorization=7654321; Domain=example2.test; Path=/",
      ]);
      expect(await result.text()).toBe("200");
    });

    it("deduplicates cookies with same name, domain, and path", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "token", "old", { domain: "example.test", path: "/app" });
        setCookie(event, "token", "new", { domain: "example.test", path: "/app" });
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual(["token=new; Domain=example.test; Path=/app"]);
      expect(await result.text()).toBe("200");
    });

    it("can set multiple different cookies", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "a", "1");
        setCookie(event, "b", "2");
        setCookie(event, "c", "3");
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/", "c=3; Path=/"]);
      expect(await result.text()).toBe("200");
    });

    it("can set cookie with all options", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "session", "xyz", {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          maxAge: 3600,
          domain: "example.test",
          path: "/secure",
        });
        return "200";
      });
      const result = await t.fetch("/");
      const cookie = result.headers.getSetCookie()[0];
      expect(cookie).toContain("session=xyz");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Max-Age=3600");
      expect(cookie).toContain("Domain=example.test");
      expect(cookie).toContain("Path=/secure");
    });
  });

  describe("deleteCookie", () => {
    it("sets cookie with maxAge=0", async () => {
      t.app.get("/", (event) => {
        deleteCookie(event, "session");
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual(["session=; Max-Age=0; Path=/"]);
      expect(await result.text()).toBe("200");
    });

    it("preserves options when deleting", async () => {
      t.app.get("/", (event) => {
        deleteCookie(event, "session", {
          domain: "example.test",
          path: "/app",
        });
        return "200";
      });
      const result = await t.fetch("/");
      const cookie = result.headers.getSetCookie()[0];
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Domain=example.test");
      expect(cookie).toContain("Path=/app");
    });
  });

  describe("getValidatedCookies", () => {
    it("validates cookies with custom validator", async () => {
      t.app.get("/", async (event) => {
        const cookies = await getValidatedCookies(event, (data) => {
          return { theme: data.theme, lang: data.lang };
        });
        expect(cookies).toEqual({ theme: "dark", lang: "en" });
        return "200";
      });

      const result = await t.fetch("/", {
        headers: { Cookie: "theme=dark; lang=en" },
      });
      expect(await result.text()).toBe("200");
    });

    it("throws on validation failure", async () => {
      t.app.get("/", async (event) => {
        const cookies = await getValidatedCookies(event, () => {
          throw new Error("invalid");
        });
        return cookies;
      });

      const result = await t.fetch("/", {
        headers: { Cookie: "bad=value" },
      });
      expect(result.status).toBe(400);
    });
  });

  it("can merge unique cookies", async () => {
    t.app.get("/", (event) => {
      setCookie(event, "session", "abc", { path: "/a" });
      setCookie(event, "session", "cba", { path: "/b" });

      setCookie(event, "session", "123", { httpOnly: false });
      setCookie(event, "session", "321", { httpOnly: true });

      setCookie(event, "session", "456", { secure: false });
      setCookie(event, "session", "654", { secure: true });

      setCookie(event, "session", "789", { sameSite: false });
      setCookie(event, "session", "987", { sameSite: true });

      return "200";
    });
    const result = await t.fetch("/");
    expect(result.headers.getSetCookie()).toEqual([
      "session=abc; Path=/a",
      "session=cba; Path=/b",
      "session=987; Path=/; SameSite=Strict",
    ]);
    expect(await result.text()).toBe("200");
  });

  describeMatrix("chunked", (t, { it, expect, describe }) => {
    const CHUNKED_COOKIE = "__chunked__";

    describe("getChunkedCookie", () => {
      it("can parse cookie that is chunked", async () => {
        t.app.get("/", (event) => {
          const authorization = getChunkedCookie(event, "Authorization");
          expect(authorization).toEqual("123456789");
          return "200";
        });

        const result = await t.fetch("/", {
          headers: {
            Cookie: [
              `Authorization=${CHUNKED_COOKIE}3`,
              "Authorization.1=123",
              "Authorization.2=456",
              "Authorization.3=789",
            ].join("; "),
          },
        });

        expect(await result.text()).toBe("200");
      });

      it("can parse cookie that is not chunked", async () => {
        t.app.get("/", (event) => {
          const authorization = getChunkedCookie(event, "Authorization");
          expect(authorization).toEqual("not-chunked");
          return "200";
        });

        const result = await t.fetch("/", {
          headers: {
            Cookie: ["Authorization=not-chunked"].join("; "),
          },
        });

        expect(await result.text()).toBe("200");
      });

      it("returns undefined when cookie does not exist", async () => {
        t.app.get("/", (event) => {
          expect(getChunkedCookie(event, "missing")).toBeUndefined();
          return "200";
        });

        const result = await t.fetch("/");
        expect(await result.text()).toBe("200");
      });

      it("returns undefined when a chunk is missing", async () => {
        t.app.get("/", (event) => {
          expect(getChunkedCookie(event, "data")).toBeUndefined();
          return "200";
        });

        const result = await t.fetch("/", {
          headers: {
            Cookie: [
              `data=${CHUNKED_COOKIE}3`,
              "data.1=aaa",
              // data.2 missing
              "data.3=ccc",
            ].join("; "),
          },
        });

        expect(await result.text()).toBe("200");
      });

      it("returns empty string for invalid chunk count", async () => {
        t.app.get("/", (event) => {
          // NaN chunk count means the loop runs 0 times, joining empty array
          expect(getChunkedCookie(event, "data")).toBe("");
          return "200";
        });

        const result = await t.fetch("/", {
          headers: {
            Cookie: `data=${CHUNKED_COOKIE}abc`,
          },
        });

        expect(await result.text()).toBe("200");
      });

      it("returns empty string for negative chunk count", async () => {
        t.app.get("/", (event) => {
          expect(getChunkedCookie(event, "data")).toBe("");
          return "200";
        });

        const result = await t.fetch("/", {
          headers: {
            Cookie: `data=${CHUNKED_COOKIE}-5`,
          },
        });

        expect(await result.text()).toBe("200");
      });
    });

    describe("chunked cookie DoS protection", () => {
      it("setChunkedCookie ignores excessively large chunk count from request cookie", async () => {
        t.app.get("/", (event) => {
          // This should NOT loop 999999 times
          setChunkedCookie(event, "session", "newvalue", {
            chunkMaxLength: 5,
          });
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: "session=__chunked__999999",
          },
        });
        expect(await result.text()).toBe("200");
        // Should only have the new cookie set, no massive cleanup
        expect(result.headers.getSetCookie().length).toBeLessThan(10);
      });

      it("deleteChunkedCookie ignores excessively large chunk count from request cookie", async () => {
        t.app.get("/", (event) => {
          // This should NOT loop 999999 times
          deleteChunkedCookie(event, "session");
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: "session=__chunked__999999",
          },
        });
        expect(await result.text()).toBe("200");
        // Should only delete the main cookie, not 999999 chunks
        expect(result.headers.getSetCookie().length).toBeLessThan(10);
      });
    });

    describe("setChunkedCookie", () => {
      it("can set-cookie with setChunkedCookie", async () => {
        t.app.get("/", (event) => {
          setChunkedCookie(event, "Authorization", "1234567890ABCDEFGHIJXYZ", {
            chunkMaxLength: 10,
          });
          return "200";
        });
        const result = await t.fetch("/");
        expect(result.headers.getSetCookie()).toMatchInlineSnapshot(`
          [
            "Authorization=__chunked__3; Path=/",
            "Authorization.1=1234567890; Path=/",
            "Authorization.2=ABCDEFGHIJ; Path=/",
            "Authorization.3=XYZ; Path=/",
          ]
        `);
        expect(await result.text()).toBe("200");
      });

      it("sets as normal cookie when value fits in one chunk", async () => {
        t.app.get("/", (event) => {
          setChunkedCookie(event, "small", "tiny", { chunkMaxLength: 10 });
          return "200";
        });
        const result = await t.fetch("/");
        expect(result.headers.getSetCookie()).toEqual(["small=tiny; Path=/"]);
        expect(await result.text()).toBe("200");
      });

      it("smaller set-cookie removes superfluous chunks", async () => {
        // set smaller cookie with fewer chunks, should have deleted superfluous chunks
        t.app.get("/", (event) => {
          setChunkedCookie(event, "Authorization", "0000100002", {
            chunkMaxLength: 5,
          });
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: [
              `Authorization=${CHUNKED_COOKIE}4; Path=/`,
              "Authorization.1=00001; Path=/",
              "Authorization.2=00002; Path=/",
              "Authorization.3=00003; Path=/",
              "Authorization.4=00004; Path=/",
            ].join("; "),
          },
        });
        expect(result.headers.getSetCookie()).toMatchInlineSnapshot(`
          [
            "Authorization.3=; Max-Age=0; Path=/",
            "Authorization.4=; Max-Age=0; Path=/",
            "Authorization=__chunked__2; Path=/",
            "Authorization.1=00001; Path=/",
            "Authorization.2=00002; Path=/",
          ]
        `);
        expect(await result.text()).toBe("200");
      });

      it("does not clean up when previous cookie is not chunked", async () => {
        t.app.get("/", (event) => {
          setChunkedCookie(event, "session", "AABBCCDD", { chunkMaxLength: 4 });
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: "session=plain-value",
          },
        });
        expect(result.headers.getSetCookie()).toEqual([
          "session=__chunked__2; Path=/",
          "session.1=AABB; Path=/",
          "session.2=CCDD; Path=/",
        ]);
        expect(await result.text()).toBe("200");
      });
    });

    describe("deleteChunkedCookie", () => {
      it("deletes all chunks of a chunked cookie", async () => {
        t.app.get("/", (event) => {
          deleteChunkedCookie(event, "session");
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: [
              `session=${CHUNKED_COOKIE}3`,
              "session.1=aaa",
              "session.2=bbb",
              "session.3=ccc",
            ].join("; "),
          },
        });
        const cookies = result.headers.getSetCookie();
        // Main cookie + 3 chunks should all be deleted
        expect(cookies).toEqual([
          "session=; Max-Age=0; Path=/",
          "session.1=; Max-Age=0; Path=/",
          "session.2=; Max-Age=0; Path=/",
          "session.3=; Max-Age=0; Path=/",
        ]);
      });

      it("deletes only main cookie when not chunked", async () => {
        t.app.get("/", (event) => {
          deleteChunkedCookie(event, "session");
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: "session=plain-value",
          },
        });
        expect(result.headers.getSetCookie()).toEqual(["session=; Max-Age=0; Path=/"]);
      });

      it("deletes only main cookie when cookie does not exist", async () => {
        t.app.get("/", (event) => {
          deleteChunkedCookie(event, "session");
          return "200";
        });
        const result = await t.fetch("/");
        expect(result.headers.getSetCookie()).toEqual(["session=; Max-Age=0; Path=/"]);
      });

      it("preserves options when deleting chunks", async () => {
        t.app.get("/", (event) => {
          deleteChunkedCookie(event, "session", {
            domain: "example.test",
            path: "/app",
          });
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: [`session=${CHUNKED_COOKIE}1`, "session.1=aaa"].join("; "),
          },
        });
        const cookies = result.headers.getSetCookie();
        for (const cookie of cookies) {
          expect(cookie).toContain("Max-Age=0");
          expect(cookie).toContain("Domain=example.test");
          expect(cookie).toContain("Path=/app");
        }
      });
    });
  });
});
