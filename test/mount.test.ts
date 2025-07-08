import { H3 } from "../src/h3.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("mount", (t, { it, expect, describe }) => {
  describe("mount fetch", () => {
    it("works with fetch function passed", async () => {
      t.app.mount("/test", (req) => new Response(new URL(req.url).pathname));
      expect(await t.fetch("/test").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/").then((r) => r.text())).toBe("/");
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });

    it("works with compat object", async () => {
      t.app.mount("/test", {
        fetch: (req: Request) => new Response(new URL(req.url).pathname),
      });
      expect(await t.fetch("/test/123").then((r) => r.text())).toBe("/123");
    });
  });

  describe("mount H3", () => {
    it("works with H3 handler", async () => {
      t.app.mount(
        "/test",
        new H3()
          .use((event) => {
            event.res.headers.set("x-test", "1");
          })
          .use((event) => {
            if (event.url.pathname === "/test/intercept") {
              return "intercepted";
            }
          })
          .get("/**:slug", (event) => ({
            url: event.url.pathname,
            slug: event.context.params?.slug,
          })),
      );

      expect(t.app._routes).toHaveLength(1);
      expect(t.app._routes[0].route).toBe("/test/**:slug");

      expect(t.app._middleware).toHaveLength(1);

      const res = await t.fetch("/test/123");
      expect(res.headers.get("x-test")).toBe("1");
      expect(await res.json()).toMatchObject({
        url: "/test/123",
        slug: "123",
      });

      const interceptRes = await t.fetch("/test/intercept");
      expect(interceptRes.headers.get("x-test")).toBe("1");
      expect(await interceptRes.text()).toBe("intercepted");
    });
  });
});
