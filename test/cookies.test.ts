import {
  getCookie,
  parseCookies,
  setCookie,
  getChunkedCookie,
  setChunkedCookie,
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
  });

  describe("setCookie", () => {
    it("can set-cookie with setCookie", async () => {
      t.app.get("/", (event) => {
        setCookie(event, "Authorization", "1234567", {});
        return "200";
      });
      const result = await t.fetch("/");
      expect(result.headers.getSetCookie()).toEqual([
        "Authorization=1234567; Path=/",
      ]);
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
              "Authorization=chunks.3",
              "Authorization.C1=123",
              "Authorization.C2=456",
              "Authorization.C3=789",
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
    });

    describe("setChunkedCookie", () => {
      it("can set-cookie with setChunkedCookie", async () => {
        t.app.get("/", (event) => {
          setChunkedCookie(
            event,
            "Authorization",
            "1234567890ABCDEFGHIJXYZ",
            {},
            10,
          );
          return "200";
        });
        const result = await t.fetch("/");
        expect(result.headers.getSetCookie()).toEqual([
          "Authorization=chunks.3; Path=/",
          "Authorization.C1=1234567890; Path=/",
          "Authorization.C2=ABCDEFGHIJ; Path=/",
          "Authorization.C3=XYZ; Path=/",
        ]);
        expect(await result.text()).toBe("200");
      });

      it("smaller set-cookie removes superfluous chunks", async () => {
        // set smaller cookie with fewer chunks, should have deleted superfluous chunks
        t.app.get("/", (event) => {
          setChunkedCookie(event, "Authorization", "0000100002", {}, 5);
          return "200";
        });
        const result = await t.fetch("/", {
          headers: {
            Cookie: [
              "Authorization=chunks.4; Path=/",
              "Authorization.C1=00001; Path=/",
              "Authorization.C2=00002; Path=/",
              "Authorization.C3=00003; Path=/",
              "Authorization.C4=00004; Path=/",
            ].join("; "),
          },
        });
        expect(result.headers.getSetCookie()).toEqual([
          "Authorization.C3=; Max-Age=0; Path=/",
          "Authorization.C4=; Max-Age=0; Path=/",
          "Authorization=chunks.2; Path=/",
          "Authorization.C1=00001; Path=/",
          "Authorization.C2=00002; Path=/",
        ]);
        expect(await result.text()).toBe("200");
      });
    });
  });
});
