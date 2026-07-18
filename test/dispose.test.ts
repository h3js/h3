import { vi } from "vitest";
import { onDispose, type H3Event } from "../src/index.ts";
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
      onDispose(event, (reason) => {
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
      onDispose(event, () => {
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
      onDispose(event, (r) => {
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

  it("maps an argless client cancellation to an AbortError reason", async () => {
    let reason: unknown = "pending";
    ctx.app.get("/test", (event) => {
      onDispose(event, (r) => {
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
    await reader.cancel(); // no argument — must still not look like normal completion
    await waitFor(() => reason !== "pending");
    if (ctx.target === "web") {
      expect(reason).toBeInstanceOf(DOMException);
      expect((reason as DOMException).name).toBe("AbortError");
    } else {
      // Node observes `res` "close" instead; reason may be `res.errored`
      expect(reason).toBeInstanceOf(Error);
    }
  });

  it.skipIf(ctx.target === "web")(
    "fires when the client disconnects while the handler is still running",
    async () => {
      // Node emits `res` "close" as soon as the socket dies — before
      // `toResponse` runs — so observation must not rely on the listener alone.
      // (On web the response is still produced and observed normally.)
      let disposed = false;
      ctx.app.get("/test", async (event) => {
        await new Promise((r) => setTimeout(r, 300)); // client aborts during this
        onDispose(event, () => {
          disposed = true;
        });
        return "hello";
      });
      const controller = new AbortController();
      const resPromise = ctx.fetch("/test", { signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await expect(resPromise).rejects.toThrow();
      await waitFor(() => disposed);
    },
  );

  it("fires after the global onResponse hook", async () => {
    const calls: string[] = [];
    ctx.hooks.onResponse.mockImplementation(() => {
      calls.push("onResponse");
    });
    ctx.app.get("/test", (event) => {
      onDispose(event, () => {
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
        onDispose(event, () => {
          calls.push("a");
          throw new Error("sync boom");
        });
        onDispose(event, async () => {
          calls.push("b");
          throw new Error("async boom");
        });
        onDispose(event, () => {
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
      onDispose(event, () => {
        disposed = true;
      });
      return "ok";
    });
    await (await ctx.fetch("/test")).text();
    await waitFor(() => disposed);
    let lateReason: unknown = "pending";
    onDispose(capturedEvent!, (reason) => {
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
      onDispose(event, () => {});
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
