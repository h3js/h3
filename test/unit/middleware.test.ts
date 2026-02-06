import { describe, expect, test, vi } from "vitest";
import { toMiddleware } from "../../src/middleware.ts";
import { mockEvent } from "../../src/index.ts";

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
