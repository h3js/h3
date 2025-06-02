import { getCookie, parseCookies, setCookie } from "../src/utils/cookie.ts";
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
});
