import { getChunkedCookie, setChunkedCookie } from "../src/utils/cookie.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("cookies", (t, { it, expect, describe }) => {
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
            "Authorization=chunks:3",
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

  // describe("setChunkedCookie", () => {
  //   it("can set-cookie with setChunkedCookie", async () => {
  //     t.app.get("/", (event) => {
  //       setChunkedCookie(event, "Authorization", "1234567", {});
  //       return "200";
  //     });
  //     const result = await t.fetch("/");
  //     expect(result.headers.getSetCookie()).toEqual([
  //       "Authorization=1234567; Path=/",
  //     ]);
  //     expect(await result.text()).toBe("200");
  //   });

  //   it("can set cookies with the same name but different serializeOptions", async () => {
  //     t.app.get("/", (event) => {
  //       setChunkedCookie(event, "Authorization", "1234567", {
  //         domain: "example1.test",
  //       });
  //       setChunkedCookie(event, "Authorization", "7654321", {
  //         domain: "example2.test",
  //       });
  //       return "200";
  //     });
  //     const result = await t.fetch("/");
  //     expect(result.headers.getSetCookie()).toEqual([
  //       "Authorization=1234567; Domain=example1.test; Path=/",
  //       "Authorization=7654321; Domain=example2.test; Path=/",
  //     ]);
  //     expect(await result.text()).toBe("200");
  //   });
  // });
});
