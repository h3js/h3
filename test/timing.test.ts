import { setServerTiming, withServerTiming } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("server-timing", (t, { it, expect }) => {
  it("setServerTiming adds header to response", async () => {
    t.app.get("/", (event) => {
      setServerTiming(event, "db", { dur: 53, desc: "Query" });
      return "ok";
    });
    const res = await t.fetch("/");
    expect(res.headers.get("server-timing")).toBe('db;desc="Query";dur=53');
    expect(await res.text()).toBe("ok");
  });

  it("multiple setServerTiming calls append entries", async () => {
    t.app.get("/", (event) => {
      setServerTiming(event, "db", { dur: 50 });
      setServerTiming(event, "cache", { dur: 2 });
      return "ok";
    });
    const res = await t.fetch("/");
    const header = res.headers.get("server-timing");
    expect(header).toContain("db;dur=50");
    expect(header).toContain("cache;dur=2");
  });

  it("withServerTiming measures and returns result", async () => {
    t.app.get("/", async (event) => {
      const val = await withServerTiming(event, "work", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { computed: true };
      });
      return val;
    });
    const res = await t.fetch("/");
    expect(await res.json()).toEqual({ computed: true });
    const header = res.headers.get("server-timing");
    expect(header).toMatch(/^work;dur=\d/);
  });

  it("setServerTiming with name only", async () => {
    t.app.get("/", (event) => {
      setServerTiming(event, "miss");
      return "ok";
    });
    const res = await t.fetch("/");
    expect(res.headers.get("server-timing")).toBe("miss");
  });
});
