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
        setChunkedCookie(event, "Authorization", "1234567890ABCDEFGHIJXYZ", {}, 10);
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
