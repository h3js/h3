import { vi } from "vitest";
import type { H3Event } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const encoder = new TextEncoder();

async function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor: condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describeMatrix("event.onDispose", (ctx, { it, expect }) => {
  it("fires after a non-streaming response", async () => {
    let disposed: unknown = "pending";
    ctx.app.get("/test", (event) => {
      event.onDispose((reason) => {
        disposed = reason;
      });
      return "hello";
    });
    const res = await ctx.fetch("/test");
    expect(await res.text()).toBe("hello");
    await waitFor(() => disposed !== "pending");
    expect(disposed).toBeUndefined();
  });

  it("fires only after a streaming body is fully consumed", async () => {
    let disposed = false;
    let releaseTail: () => void;
    const tail = new Promise<void>((r) => {
      releaseTail = r;
    });
    ctx.app.get("/test", (event) => {
      event.onDispose(() => {
        disposed = true;
      });
      return new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("head"));
          await tail;
          controller.enqueue(encoder.encode("tail"));
          controller.close();
        },
      });
    });
    const res = await ctx.fetch("/test");
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    // Response is produced and streaming — must not be disposed yet
    await new Promise((r) => setTimeout(r, 20));
    expect(disposed).toBe(false);
    releaseTail!();
    while (!(await reader.read()).done) {
      // consume
    }
    await waitFor(() => disposed);
  });

  it("fires with a reason when the client disconnects mid-stream", async () => {
    let reason: unknown = "pending";
    ctx.app.get("/test", (event) => {
      event.onDispose((r) => {
        reason = r;
      });
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("head"));
          // Keep the stream open — only a client disconnect can end it
        },
      });
    });
    const res = await ctx.fetch("/test");
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel("client gone");
    await waitFor(() => reason !== "pending");
    if (ctx.target === "web") {
      // The consumer's cancel reason propagates through the body observer
      expect(reason).toBe("client gone");
    } else {
      // Premature close on Node surfaces as an abort-like error
      expect(reason).toBeInstanceOf(Error);
    }
  });

  it("fires after the global onResponse hook", async () => {
    const calls: string[] = [];
    ctx.hooks.onResponse.mockImplementation(() => {
      calls.push("onResponse");
    });
    ctx.app.get("/test", (event) => {
      event.onDispose(() => {
        calls.push("dispose");
      });
      return "ok";
    });
    await (await ctx.fetch("/test")).text();
    await waitFor(() => calls.includes("dispose"));
    expect(calls).toEqual(["onResponse", "dispose"]);
  });

  it("runs callbacks in order and absorbs sync throws and async rejections", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const calls: string[] = [];
      ctx.app.get("/test", (event) => {
        event.onDispose(() => {
          calls.push("a");
          throw new Error("sync boom");
        });
        event.onDispose(async () => {
          calls.push("b");
          throw new Error("async boom");
        });
        event.onDispose(() => {
          calls.push("c");
        });
        return "ok";
      });
      const res = await ctx.fetch("/test");
      expect(await res.text()).toBe("ok");
      await waitFor(() => calls.length === 3);
      expect(calls).toEqual(["a", "b", "c"]);
      await waitFor(() => consoleError.mock.calls.length === 2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("registering after disposal fires immediately with the same reason", async () => {
    let capturedEvent: H3Event | undefined;
    let disposed = false;
    ctx.app.get("/test", (event) => {
      capturedEvent = event;
      event.onDispose(() => {
        disposed = true;
      });
      return "ok";
    });
    await (await ctx.fetch("/test")).text();
    await waitFor(() => disposed);
    let lateReason: unknown = "pending";
    capturedEvent!.onDispose((reason) => {
      lateReason = reason;
    });
    expect(lateReason).toBeUndefined();
  });

  it("does not alter responses without registered callbacks", async () => {
    ctx.app.get("/test", (event) => {
      event.res.headers.set("x-test", "1");
      return { hello: "world" };
    });
    const res = await ctx.fetch("/test");
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("preserves status and headers on observed streaming responses", async () => {
    ctx.app.get("/test", (event) => {
      event.onDispose(() => {});
      event.res.status = 201;
      event.res.headers.set("x-test", "1");
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("body"));
          controller.close();
        },
      });
    });
    const res = await ctx.fetch("/test");
    expect(res.status).toBe(201);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.text()).toBe("body");
  });
});
