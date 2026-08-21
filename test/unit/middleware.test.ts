import { describe, expect, test, vi } from "vitest";
import { toMiddleware } from "../../src/middleware.ts";
import { H3, mockEvent } from "../../src/index.ts";

import type { Middleware } from "../../src/types/handler.ts";

describe("toMiddleware", () => {
  test("fetchable", async () => {
    const middleware = toMiddleware({
      fetch() {
        return new Response("ok");
      },
    });
    const next = vi.fn();
    const res = await middleware(mockEvent("/"), next);
    expect(next).not.toHaveBeenCalled();
    expect(await (res as Response)!.text()).toBe("ok");
  });

  test("fetchable (404)", async () => {
    const middleware = toMiddleware({
      fetch() {
        return new Response("404", { status: 404 });
      },
    });
    const next = vi.fn();
    await middleware(mockEvent("/"), next);
    expect(next).toHaveBeenCalled();
  });

  test("handler", () => {
    const middleware = toMiddleware(() => "OK");
    const next = vi.fn();
    const res = middleware(mockEvent("/"), next);
    expect(next).not.toHaveBeenCalled();
    expect(res).toBe("OK");
  });

  test("handler (async)", async () => {
    const middleware = toMiddleware(async () => "OK");
    const next = vi.fn();
    const res = await middleware(mockEvent("/"), next);
    expect(next).not.toHaveBeenCalled();
    expect(res).toBe("OK");
  });

  test("handler (async 404)", async () => {
    const middleware = toMiddleware(async () => undefined);
    const next = vi.fn();
    await middleware(mockEvent("/"), next);
    expect(next).toHaveBeenCalled();
  });

  test("middleware", async () => {
    const _middleware = (_: any, next: any) => next();
    const middleware = toMiddleware(_middleware);
    expect(middleware).toBe(_middleware);
  });

  test("invalid", async () => {
    const middleware = toMiddleware({ handler: "boo" } as any);
    const next = vi.fn();
    expect(middleware.name).toBe("noopMiddleware");
    await middleware(mockEvent("/"), next);
    expect(next).toHaveBeenCalled();
  });
});

describe("composed middleware invalidation", () => {
  test("use() after first request invalidates the composed chain", async () => {
    const app = new H3().get("/t", () => "ok");
    app.use((_, next) => next());
    expect(await (await app.request("/t")).text()).toBe("ok");
    app.use(() => "intercepted");
    expect(await (await app.request("/t")).text()).toBe("intercepted");
  });

  test("use() on a mounted app after first request invalidates its chain", async () => {
    const child = new H3().get("/t", () => "ok");
    child.use((_, next) => next());
    const app = new H3().mount("/sub", child);
    expect(await (await app.request("/sub/t")).text()).toBe("ok");
    child.use(() => "intercepted");
    expect(await (await app.request("/sub/t")).text()).toBe("intercepted");
  });
});

describe("~getMiddleware compat", () => {
  test("instance-level override provides per-event middleware (nitro pattern)", async () => {
    const app = new H3().get("/test", (event) => `handler:${event.context.order}`);
    const push = (name: string): Middleware => {
      return (event, next) => {
        event.context.order = `${event.context.order || ""}+${name}`;
        return next();
      };
    };
    app.use(push("global"));
    // Nitro assigns an instance-level override returning a per-event array:
    // https://github.com/nitrojs/nitro/blob/main/src/build/virtual/app.ts
    app["~getMiddleware"] = (event, route) => {
      const middleware = [...app["~middleware"]];
      if (event.url.pathname === "/test" && route) {
        middleware.push(push("extra"));
      }
      return middleware;
    };
    // Repeated requests: override must run per event (no stale precomposition)
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/test");
      expect(await res.text()).toBe("handler:+global+extra");
    }
  });

  test("override that omits route middleware still runs it (#1525)", async () => {
    const seen: string[] = [];
    const app = new H3();
    app.use(() => {
      seen.push("global");
    });
    app.get("/x", () => "ok", {
      middleware: [
        () => {
          seen.push("route");
        },
      ],
    });
    app["~getMiddleware"] = function () {
      return this["~middleware"];
    };

    const res = await app.request("/x");
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["global", "route"]);
    // Must not mutate the global middleware list returned by the override.
    expect(app["~middleware"]).toHaveLength(1);
  });

  test("override that re-adds route middleware does not double-run it (nitro)", async () => {
    const seen: string[] = [];
    const app = new H3();
    app.use(() => {
      seen.push("global");
    });
    const routeMw = () => {
      seen.push("route");
    };
    app.get("/x", () => "ok", { middleware: [routeMw] });
    app["~getMiddleware"] = function (_event, route) {
      const middleware = [...this["~middleware"]];
      if (route?.data?.middleware?.length) {
        middleware.push(...route.data.middleware);
      }
      return middleware;
    };

    const res = await app.request("/x");
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["global", "route"]);
  });

  test("same function as global and route middleware still runs twice", async () => {
    const seen: string[] = [];
    const mw = () => {
      seen.push("mw");
    };
    const app = new H3();
    app.use(mw);
    app.get("/x", () => "ok", { middleware: [mw] });
    app["~getMiddleware"] = function () {
      return this["~middleware"];
    };

    const res = await app.request("/x");
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["mw", "mw"]);
  });

  test("nitro-style override keeps dual registration at two runs", async () => {
    const seen: string[] = [];
    const mw = () => {
      seen.push("mw");
    };
    const app = new H3();
    app.use(mw);
    app.get("/x", () => "ok", { middleware: [mw] });
    app["~getMiddleware"] = function (_event, route) {
      const middleware = [...this["~middleware"]];
      if (route?.data?.middleware?.length) {
        middleware.push(...route.data.middleware);
      }
      return middleware;
    };

    const res = await app.request("/x");
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["mw", "mw"]);
  });
});
