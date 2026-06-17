import { getRequestId, HTTPError, requestId } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("requestId", (t, { it, expect }) => {
  it("generates and propagates a request id", async () => {
    t.app.use(requestId());
    t.app.get("/test", (event) => ({
      requestId: getRequestId(event),
    }));

    const result = await t.fetch("/test");
    const body = await result.json();

    expect(result.headers.get("x-request-id")).toBeTruthy();
    expect(body.requestId).toBe(result.headers.get("x-request-id"));
  });

  it("reuses incoming request id header", async () => {
    t.app.use(requestId());
    t.app.get("/test", (event) => getRequestId(event));

    const result = await t.fetch("/test", {
      headers: {
        "x-request-id": "incoming-id",
      },
    });

    expect(await result.text()).toBe("incoming-id");
    expect(result.headers.get("x-request-id")).toBe("incoming-id");
  });

  it("generates a new id when trustIncoming is disabled", async () => {
    t.app.use(requestId({ trustIncoming: false, generate: () => "generated-id" }));
    t.app.get("/test", (event) => getRequestId(event));

    const result = await t.fetch("/test", {
      headers: {
        "x-request-id": "incoming-id",
      },
    });

    expect(await result.text()).toBe("generated-id");
    expect(result.headers.get("x-request-id")).toBe("generated-id");
  });

  it("propagates request id on error responses", async () => {
    t.app.use(requestId({ generate: () => "error-id" }));
    t.app.get("/test", () => {
      throw new HTTPError({ status: 400, message: "boom" });
    });

    const result = await t.fetch("/test");

    expect(result.status).toBe(400);
    expect(result.headers.get("x-request-id")).toBe("error-id");
  });
});
