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
});
