import { requestId } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("requestId", (t, { it, expect }) => {
  it("generates an id and exposes it via event.context and the response header", async () => {
    let contextId: string | undefined;
    t.app.use(requestId());
    t.app.get("/test", (event) => {
      contextId = event.context.requestId;
      return "ok";
    });

    const res = await t.fetch("/test");
    expect(res.status).toBe(200);
    const headerId = res.headers.get("x-request-id");
    expect(headerId).toBeTruthy();
    expect(contextId).toBe(headerId);
  });

  it("generates a different id per request", async () => {
    t.app.use(requestId());
    t.app.get("/test", () => "ok");

    const res1 = await t.fetch("/test");
    const res2 = await t.fetch("/test");
    expect(res1.headers.get("x-request-id")).not.toBe(res2.headers.get("x-request-id"));
  });

  it("reuses an incoming request id header by default", async () => {
    t.app.use(requestId());
    t.app.get("/test", (event) => event.context.requestId || "");

    const res = await t.fetch("/test", { headers: { "x-request-id": "incoming-id" } });
    expect(res.headers.get("x-request-id")).toBe("incoming-id");
    expect(await res.text()).toBe("incoming-id");
  });

  it("ignores an incoming header when trustIncoming is false", async () => {
    t.app.use(requestId({ trustIncoming: false }));
    t.app.get("/test", () => "ok");

    const res = await t.fetch("/test", { headers: { "x-request-id": "incoming-id" } });
    expect(res.headers.get("x-request-id")).not.toBe("incoming-id");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("supports a custom header name", async () => {
    t.app.use(requestId({ header: "x-trace-id" }));
    t.app.get("/test", (event) => event.context.requestId || "");

    const res = await t.fetch("/test", { headers: { "x-trace-id": "trace-123" } });
    expect(res.headers.get("x-trace-id")).toBe("trace-123");
    expect(res.headers.get("x-request-id")).toBeNull();
    expect(await res.text()).toBe("trace-123");
  });

  it("supports a custom generate function", async () => {
    let counter = 0;
    t.app.use(requestId({ generate: () => `custom-${++counter}` }));
    t.app.get("/test", () => "ok");

    const res = await t.fetch("/test");
    expect(res.headers.get("x-request-id")).toBe("custom-1");
  });

  it("does not overwrite a response header already set upstream", async () => {
    t.app.use((event, next) => {
      event.res.headers.set("x-request-id", "manual-id");
      return next();
    });
    t.app.use(requestId());
    t.app.get("/test", (event) => event.context.requestId || "");

    const res = await t.fetch("/test");
    expect(res.headers.get("x-request-id")).toBe("manual-id");
    // event.context.requestId is still assigned, even though the response header wasn't overwritten
    expect(await res.text()).not.toBe("manual-id");
  });
});
