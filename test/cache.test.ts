import { createMemoryStorage, defineCachedHandler } from "ocache";
import { HTTPError, defineHandler, handleCacheHeaders, toResponse } from "../src/index.ts";
import { withCacheIsolation } from "../src/index.ts";
import type { H3Event } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("withCacheIsolation", (t, { it, expect }) => {
  // A handler-level cache the way frameworks such as Nitro build one (h3js/h3#1607).
  const createCached = (handler: (event: H3Event) => unknown) =>
    withCacheIsolation(
      defineCachedHandler(handler, {
        storage: createMemoryStorage(),
        maxAge: 60,
        toResponse: (value, event) => toResponse(value, event as H3Event),
        handleCacheHeaders: (event, conditions) => handleCacheHeaders(event as H3Event, conditions),
      }),
    );

  it("keeps middleware-staged headers out of the cache entry", async () => {
    const cached = createCached(() => "hello");
    t.app.use((event) => {
      const echo = event.req.headers.get("x-echo");
      if (echo) event.res.headers.set("x-echo", echo);
    });
    t.app.get(
      "/cached",
      defineHandler((event) => cached(event)),
    );

    const miss = await t.fetch("/cached", { headers: { "x-echo": "a" } });
    expect(miss.headers.get("x-echo")).toBe("a");
    expect(await miss.text()).toBe("hello");

    const hit = await t.fetch("/cached");
    expect(hit.headers.get("x-echo")).toBeNull();
    expect(await hit.text()).toBe("hello");

    const other = await t.fetch("/cached", { headers: { "x-echo": "b" } });
    expect(other.headers.get("x-echo")).toBe("b");
  });

  it("keeps middleware-staged cookies out of the cache entry", async () => {
    const cached = createCached(() => "hello");
    t.app.use((event) => {
      const user = event.req.headers.get("x-user");
      if (user) event.res.headers.append("set-cookie", `user=${user}`);
    });
    t.app.get("/cached", cached);

    const miss = await t.fetch("/cached", { headers: { "x-user": "alice" } });
    expect(miss.headers.get("set-cookie")).toBe("user=alice");
    const hit = await t.fetch("/cached");
    expect(hit.headers.get("set-cookie")).toBeNull();
  });

  it("still caches a route behind middleware that stages `vary: origin`", async () => {
    let calls = 0;
    const cached = createCached(() => `hello ${++calls}`);
    t.app.use((event) => {
      event.res.headers.set("vary", "origin");
    });
    t.app.get("/cached", cached);

    const first = await t.fetch("/cached");
    expect(await first.text()).toBe("hello 1");
    expect(first.headers.get("vary")).toBe("origin");
    const second = await t.fetch("/cached");
    expect(await second.text()).toBe("hello 1");
    expect(second.headers.get("vary")).toBe("origin");
  });

  it("does not store a response that middleware staged as `private`", async () => {
    let calls = 0;
    const cached = createCached(() => `hello ${++calls}`);
    t.app.use((event) => {
      event.res.headers.set("cache-control", "private, no-store");
    });
    t.app.get("/cached", cached);

    expect(await (await t.fetch("/cached")).text()).toBe("hello 1");
    expect(await (await t.fetch("/cached")).text()).toBe("hello 2");
  });

  it("does not store a response that middleware staged with `vary: *`", async () => {
    let calls = 0;
    const cached = createCached(() => `hello ${++calls}`);
    t.app.use((event) => {
      event.res.headers.set("vary", "*");
    });
    t.app.get("/cached", cached);

    expect(await (await t.fetch("/cached")).text()).toBe("hello 1");
    expect(await (await t.fetch("/cached")).text()).toBe("hello 2");
  });

  it("keeps staged success headers off an error response", async () => {
    t.app.use((event) => {
      event.res.headers.set("x-echo", "a");
    });
    t.app.get(
      "/missing",
      withCacheIsolation(() => new Response("missing", { status: 404 })),
    );

    const res = await t.fetch("/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-echo")).toBeNull();
  });

  it("restores staged headers for a handler that does not return a `Response`", async () => {
    t.app.use((event) => {
      event.res.headers.set("x-echo", "a");
    });
    t.app.get(
      "/plain",
      withCacheIsolation((event) => {
        expect(event.res.headers.get("x-echo")).toBeNull();
        event.res.headers.set("x-handler", "1");
        return "plain";
      }),
    );

    const res = await t.fetch("/plain");
    expect(await res.text()).toBe("plain");
    expect(res.headers.get("x-echo")).toBe("a");
    expect(res.headers.get("x-handler")).toBe("1");
  });

  it("restores staged headers when the handler throws", async () => {
    t.app.use((event) => {
      event.res.errHeaders.set("x-err", "1");
      event.res.headers.set("x-echo", "a");
    });
    t.app.get(
      "/throws",
      withCacheIsolation(() => {
        throw new HTTPError({ status: 418 });
      }),
    );
    let staged: string | null = null;
    t.hooks.onError.mockImplementationOnce((_error, event: H3Event) => {
      staged = event.res.headers.get("x-echo");
    });

    const res = await t.fetch("/throws");
    expect(staged).toBe("a");
    expect(res.status).toBe(418);
    expect(res.headers.get("x-err")).toBe("1");
    expect(res.headers.get("x-echo")).toBeNull();
  });
});
