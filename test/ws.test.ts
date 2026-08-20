import { describe, it, expect } from "vitest";
import { H3, defineWebSocket, defineWebSocketHandler } from "../src/index.ts";
import { routeRules } from "../src/rules/middleware.ts";
import type { ServerRequest } from "srvx";

const hooks = { message: () => {} };

describe("defineWebSocket", () => {
  it("should return the provided hooks", () => {
    const result = defineWebSocket(hooks);
    expect(result).toEqual(hooks);
  });
});

describe("defineWebSocketHandler", () => {
  it("should attach the provided hooks", () => {
    const wsHandler = defineWebSocketHandler(hooks);
    const res = wsHandler({} as any);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    // expect((res as Response).statusText).toBe("Upgrade Required");
    expect((res as any).crossws).toEqual(hooks);
  });

  it("should attach the provided hooks with function argument", () => {
    const wsHandler = defineWebSocketHandler(() => hooks);
    const res = wsHandler({} as any);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    // expect((res as Response).statusText).toBe("Upgrade Required");
    expect((res as any).crossws).toEqual(hooks);
  });

  it("should serve the http handler for non-upgrade requests", () => {
    const wsHandler = defineWebSocketHandler(hooks, () => "hello");
    const event = { req: new Request("http://localhost/") } as any;
    expect(wsHandler(event)).toBe("hello");
  });

  it("should attach hooks for upgrade requests even with an http handler", () => {
    const wsHandler = defineWebSocketHandler(hooks, () => "hello");
    const event = {
      req: new Request("http://localhost/", {
        headers: { connection: "Upgrade", upgrade: "websocket" },
      }),
    } as any;
    const res = wsHandler(event);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(426);
    expect((res as any).crossws).toEqual(hooks);
  });

  it("exposes crossws on the returned response", () => {
    // Given a WebSocket handler defined via defineWebSocketHandler
    const wsHandler = defineWebSocketHandler(hooks);
    // When the handler is invoked in-process (as crossws adapters do internally)
    const res = wsHandler({} as any);
    // Then `res.crossws` is readable, typed, and is the exact hooks object
    expect(res.crossws).toBe(hooks);
  });

  it("awaits an async hooks factory before attaching crossws", async () => {
    // Given a WebSocket handler defined with an async hooks factory
    const wsHandler = defineWebSocketHandler(async (_event) => {
      await Promise.resolve();
      return hooks;
    });
    // When the handler is invoked in-process (as crossws adapters do internally)
    // Then the return type already reflects the Promise branch, no cast needed
    const res = await wsHandler({} as any);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(426);
    // Then `crossws` is the resolved hooks object, not an unresolved Promise
    expect(res.crossws).not.toBeInstanceOf(Promise);
    expect(res.crossws).toEqual(hooks);
  });
});

// crossws resolves the hooks of an upgrade request by calling `app.fetch()` and
// reading them back from the request (`Symbol.for("crossws.hooks")`, its documented
// wire format). That channel is used rather than the response property because a
// `Response` is rebuilt whenever anything stages a response header on the way out,
// and a rebuild carries none of the original's own properties.
describe("defineWebSocketHandler through the app pipeline", () => {
  // crossws' documented wire format, spelled out locally: it stays a types-only
  // optional peer dependency, so nothing here imports it at runtime.
  const kHooks = Symbol.for("crossws.hooks");
  const readHooks = (req: Request) => (req as any)[kHooks] ?? (req as any).context?.[kHooks];
  const upgradeRequest = (url = "http://localhost/_ws") =>
    new Request(url, { headers: { upgrade: "websocket" } });

  it("hands the hooks off on the request", async () => {
    const app = new H3();
    app.get("/_ws", defineWebSocketHandler(hooks));

    const req = upgradeRequest();
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect(readHooks(req)).toBe(hooks);
    // Nothing rebuilt the response here, so the convenience property is intact too.
    expect((res as any).crossws).toBe(hooks);
  });

  it("hands the hooks off when middleware stages a response header", async () => {
    const app = new H3();
    app.use((event) => {
      event.res.headers.set("x-mw", "1");
      event.res.errHeaders.set("x-mw", "1");
    });
    app.get("/_ws", defineWebSocketHandler(hooks));

    const req = upgradeRequest();
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect(res.headers.get("x-mw")).toBe("1");
    expect(readHooks(req)).toBe(hooks);
  });

  it("hands the hooks off under a headers route rule", async () => {
    const app = new H3();
    app.use(routeRules({ "**": { headers: { "x-test": "test" } } }));
    app.get("/_ws", defineWebSocketHandler(hooks));

    const req = upgradeRequest();
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect(res.headers.get("x-test")).toBe("test");
    expect(readHooks(req)).toBe(hooks);
  });

  it("hands the hooks off when a middleware rebuilds the response", async () => {
    const app = new H3();
    app.use(async (_event, next) => {
      const res = (await next()) as Response;
      // A layer outside h3's own normalization — own properties do not survive.
      return new Response(res.body, res);
    });
    app.get("/_ws", defineWebSocketHandler(hooks));

    const req = upgradeRequest();
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect((res as any).crossws).toBeUndefined();
    expect(readHooks(req)).toBe(hooks);
  });

  it("hands the hooks off on the outer request for a mounted sub-app", async () => {
    const sub = new H3();
    sub.get("/_ws", defineWebSocketHandler(hooks));
    const app = new H3();
    app.mount("/api", sub);

    // `mount()` hands the sub-app a request proxy, whose writes forward to the
    // request crossws holds — so the hooks land where the resolver reads them.
    const req = upgradeRequest("http://localhost/api/_ws");
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect(readHooks(req)).toBe(hooks);
  });

  it("hands the hooks off through the context bag when the request is replaced", async () => {
    const app = new H3();
    app.use((event) => {
      // What the `cache` rule does when it normalizes headers for the cache key:
      // a fresh `Request`, carrying the same `context` reference forward. The
      // symbol written on it never reaches the request crossws is holding.
      const original = event.req;
      const req = new Request(original.url, {
        method: original.method,
        headers: original.headers,
      }) as ServerRequest;
      req.context = original.context;
      (event as { req: ServerRequest }).req = req;
    });
    app.get("/_ws", defineWebSocketHandler(hooks));

    const req = upgradeRequest();
    const res = await app.fetch(req);

    expect(res.status).toBe(426);
    expect((req as any)[kHooks]).toBeUndefined();
    expect(readHooks(req)).toBe(hooks);
  });

  it("hands the hooks off from an async hooks factory", async () => {
    const app = new H3();
    app.get(
      "/_ws",
      defineWebSocketHandler(async () => {
        await Promise.resolve();
        return hooks;
      }),
    );

    const req = upgradeRequest();
    await app.fetch(req);

    expect(readHooks(req)).toBe(hooks);
  });
});
