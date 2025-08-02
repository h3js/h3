import { jsonRpcHandler } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("json-rpc", (t, { it, expect }) => {
  const eventHandler = jsonRpcHandler({
    test: (params, event) => {
      return `Recieved ${params} on path ${event.url.pathname}`;
    },
  });
  it("should handle a valid JSON-RPC request", async () => {
    t.app.post("/json-rpc", eventHandler);
    const result = await t.fetch("/json-rpc", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "test",
        params: "Hello World",
        id: 1,
      }),
    });

    expect(await result.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: "Recieved Hello World on path /json-rpc",
    });
  });

  it("should respond with a 202 for a valid JSON-RPC notification", async () => {
    t.app.post("/json-rpc", eventHandler);
    const result = await t.fetch("/json-rpc", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "test",
        params: "Hello World",
        // No ID for notification
      }),
    });

    expect(await result.text()).toBe("");
    expect(result.status).toBe(202);
  });

  it("should return an error for an invalid JSON-RPC request", async () => {
    t.app.post("/json-rpc", eventHandler);
    const result = await t.fetch("/json-rpc", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "1.0", // Invalid version
        method: "test",
        // Missing params
        id: 1,
      }),
    });

    expect(await result.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32_600, // Invalid Request
        message: "Invalid Request",
      },
    });
  });
});
