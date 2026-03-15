import { describe, it, expect } from "vitest";
import { mockEvent, setServerTiming, withServerTiming } from "../../src/index.ts";

describe("server-timing (unit)", () => {
  it("sets server-timing header with name only", () => {
    const event = mockEvent("/");
    setServerTiming(event, "miss");
    expect(event.res.headers.get("server-timing")).toBe("miss");
  });

  it("sets server-timing header with duration", () => {
    const event = mockEvent("/");
    setServerTiming(event, "db", { dur: 53 });
    expect(event.res.headers.get("server-timing")).toBe("db;dur=53");
  });

  it("sets server-timing header with description", () => {
    const event = mockEvent("/");
    setServerTiming(event, "db", { desc: "Database query" });
    expect(event.res.headers.get("server-timing")).toBe('db;desc="Database query"');
  });

  it("sets server-timing header with duration and description", () => {
    const event = mockEvent("/");
    setServerTiming(event, "db", { dur: 53.2, desc: "Database" });
    expect(event.res.headers.get("server-timing")).toBe('db;desc="Database";dur=53.2');
  });

  it("appends multiple entries", () => {
    const event = mockEvent("/");
    setServerTiming(event, "db", { dur: 53 });
    setServerTiming(event, "cache", { dur: 1.2, desc: "Redis" });
    const header = event.res.headers.get("server-timing");
    expect(header).toContain("db;dur=53");
    expect(header).toContain('cache;desc="Redis";dur=1.2');
  });

  it("stores timings in event.context.timing", () => {
    const event = mockEvent("/");
    setServerTiming(event, "db", { dur: 53, desc: "Query" });
    setServerTiming(event, "cache", { dur: 1.2 });
    expect((event.context as any).timing).toEqual([
      { name: "db", dur: 53, desc: "Query" },
      { name: "cache", dur: 1.2 },
    ]);
  });

  it("withServerTiming measures and appends timing", async () => {
    const event = mockEvent("/");
    const result = await withServerTiming(event, "work", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    expect(result).toBe(42);
    const header = event.res.headers.get("server-timing");
    expect(header).toMatch(/^work;dur=\d/);
  });

  it("withServerTiming works with sync functions", async () => {
    const event = mockEvent("/");
    const result = await withServerTiming(event, "sync", () => "hello");
    expect(result).toBe("hello");
    expect(event.res.headers.get("server-timing")).toMatch(/^sync;dur=/);
  });

  it("withServerTiming propagates errors", async () => {
    const event = mockEvent("/");
    await expect(
      withServerTiming(event, "fail", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
