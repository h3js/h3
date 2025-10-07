import { noContent } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("event response", (t, { it, describe, expect }) => {
  async function webResponseToPlain(res: Response) {
    return {
      status: res.status,
      statusText: res.statusText,
      body: await res.text(),
      headers: Object.fromEntries(res.headers.entries()),
    };
  }

  describe("content response", () => {
    it("sets status 200 as default", async () => {
      t.app.all("/test", () => "text");

      const res = await t.fetch("/test", {
        method: "POST",
      });

      expect(await webResponseToPlain(res)).toMatchObject({
        status: 200,
        statusText: "OK",
        body: "text",
        headers:
          t.target === "web"
            ? {}
            : {
                connection: "keep-alive",
                // "content-length": "4",
                date: expect.any(String),
                "keep-alive": "timeout=5",
              },
      });
    });

    it("override status and statusText", async () => {
      t.app.all("/test", (event) => {
        event.res.status = 418;
        event.res.statusText = "custom-status";
        return "text";
      });

      const res = await t.fetch("/test", {
        method: "POST",
        body: "",
      });

      expect(await webResponseToPlain(res)).toMatchObject({
        status: 418,
        statusText: "custom-status",
        body: "text",
        headers:
          t.target === "web"
            ? {}
            : {
                connection: "keep-alive",
                // "content-length": "4",
                date: expect.any(String),
                "keep-alive": "timeout=5",
              },
      });
    });
  });

  describe("no content response", () => {
    it("sets status 204 as default", async () => {
      t.app.all("/test", () => {
        return noContent();
      });

      const res = await t.fetch("/test", {
        method: "POST",
      });

      expect(await webResponseToPlain(res)).toMatchObject({
        status: 204,
        statusText: "No Content",
        body: "",
        headers: {},
      });
    });
    it("override status and statusText with setResponseStatus method", async () => {
      t.app.all("/test", (event) => {
        event.res.status = 418;
        event.res.statusText = "status-text";
        return "";
      });

      const res = await t.fetch("/test", {
        method: "POST",
        body: "",
      });

      expect(await webResponseToPlain(res)).toMatchObject({
        status: 418,
        statusText: "status-text",
        body: "",
        headers: {},
      });
    });

    it("does not sets content-type for 304", async () => {
      t.app.all("/test", (event) => {
        event.res.status = 304;
        event.res.statusText = "Not Modified";
        return "";
      });

      const res = await t.fetch("/test");

      expect(await webResponseToPlain(res)).toMatchObject({
        status: 304,
        statusText: "Not Modified",
        body: "",
        headers: {},
      });
    });
  });
});
