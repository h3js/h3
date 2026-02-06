import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod/v4";
import {
  defineMcpTool,
  defineMcpResource,
  defineMcpPrompt,
  defineMcpHandler,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

// ---- Definition Helpers (unit tests) ----

describe("defineMcpTool", () => {
  it("should return the definition as-is", () => {
    const handler = async () => ({
      content: [{ type: "text" as const, text: "hello" }],
    });
    const tool = defineMcpTool({
      name: "test-tool",
      description: "A test tool",
      handler,
    });
    expect(tool.name).toBe("test-tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.handler).toBe(handler);
  });

  it("should preserve inputSchema", () => {
    const tool = defineMcpTool({
      name: "with-schema",
      inputSchema: { message: z.string() },
      handler: async ({ message }) => ({
        content: [{ type: "text" as const, text: message }],
      }),
    });
    expect(tool.name).toBe("with-schema");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema!.message).toBeDefined();
  });
});

describe("defineMcpResource", () => {
  it("should return the definition as-is", () => {
    const handler = async (uri: URL) => ({
      contents: [{ uri: uri.toString(), text: "content" }],
    });
    const resource = defineMcpResource({
      name: "test-resource",
      uri: "file:///test",
      description: "A test resource",
      handler,
    });
    expect(resource.name).toBe("test-resource");
    expect(resource.uri).toBe("file:///test");
    expect(resource.handler).toBe(handler);
  });
});

describe("defineMcpPrompt", () => {
  it("should return the definition as-is", () => {
    const handler = async () => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: "Hello!" },
        },
      ],
    });
    const prompt = defineMcpPrompt({
      name: "test-prompt",
      description: "A test prompt",
      handler,
    });
    expect(prompt.name).toBe("test-prompt");
    expect(prompt.description).toBe("A test prompt");
    expect(prompt.handler).toBe(handler);
  });

  it("should preserve argsSchema", () => {
    const prompt = defineMcpPrompt({
      name: "with-args",
      argsSchema: { name: z.string() },
      handler: async ({ name }) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: `Hello ${name}!` },
          },
        ],
      }),
    });
    expect(prompt.argsSchema).toBeDefined();
    expect(prompt.argsSchema!.name).toBeDefined();
  });
});

// ---- MCP Handler (integration tests) ----

describeMatrix("defineMcpHandler", (t, { it, expect }) => {
  const echoTool = defineMcpTool({
    name: "echo",
    description: "Echo back a message",
    inputSchema: { message: z.string() },
    handler: async ({ message }) => ({
      content: [{ type: "text" as const, text: message }],
    }),
  });

  const greetTool = defineMcpTool({
    name: "greet",
    description: "Greet someone",
    handler: async () => ({
      content: [{ type: "text" as const, text: "Hello!" }],
    }),
  });

  const readmeResource = defineMcpResource({
    name: "readme",
    uri: "file:///readme",
    description: "Project README",
    handler: async (uri) => ({
      contents: [{ uri: uri.toString(), text: "# My Project\nHello world" }],
    }),
  });

  const greetPrompt = defineMcpPrompt({
    name: "greet",
    description: "Generate a greeting",
    argsSchema: { name: z.string() },
    handler: async ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: `Hello ${name}!` },
        },
      ],
    }),
  });

  beforeEach(() => {
    t.app.all(
      "/mcp",
      defineMcpHandler({
        name: "test-server",
        version: "1.0.0",
        tools: [echoTool, greetTool],
        resources: [readmeResource],
        prompts: [greetPrompt],
      }),
    );
  });

  // Helper to send JSON-RPC requests
  function jsonRpc(method: string, params?: unknown, id: number = 1) {
    return t.fetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  }

  // Helper to send JSON-RPC notifications (no id)
  function jsonRpcNotification(method: string, params?: unknown) {
    return t.fetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  }

  it("should handle initialize", async () => {
    const res = await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.serverInfo.name).toBe("test-server");
    expect(body.result.serverInfo.version).toBe("1.0.0");
    expect(body.result.capabilities).toBeDefined();
  });

  it("should handle tools/list", async () => {
    // First initialize
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("tools/list", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toBeDefined();
    expect(body.result.tools.length).toBe(2);

    const toolNames = body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("echo");
    expect(toolNames).toContain("greet");
  });

  it("should handle tools/call", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc(
      "tools/call",
      { name: "echo", arguments: { message: "hello world" } },
      2,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("should handle tools/call without arguments", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("tools/call", { name: "greet" }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content).toEqual([{ type: "text", text: "Hello!" }]);
  });

  it("should handle resources/list", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("resources/list", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.resources).toBeDefined();
    expect(body.result.resources.length).toBe(1);
    expect(body.result.resources[0].name).toBe("readme");
    expect(body.result.resources[0].uri).toBe("file:///readme");
  });

  it("should handle resources/read", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("resources/read", { uri: "file:///readme" }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.contents).toBeDefined();
    expect(body.result.contents[0].text).toBe("# My Project\nHello world");
  });

  it("should handle prompts/list", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("prompts/list", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.prompts).toBeDefined();
    expect(body.result.prompts.length).toBe(1);
    expect(body.result.prompts[0].name).toBe("greet");
  });

  it("should handle prompts/get", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("prompts/get", { name: "greet", arguments: { name: "World" } }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.messages).toBeDefined();
    expect(body.result.messages[0].content.text).toBe("Hello World!");
  });

  it("should handle ping", async () => {
    await jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const res = await jsonRpc("ping", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeDefined();
  });

  it("should return 202 for notifications", async () => {
    const res = await jsonRpcNotification("notifications/initialized");
    expect(res.status).toBe(202);
  });

  it("should return 405 for GET", async () => {
    const res = await t.fetch("/mcp");
    expect(res.status).toBe(405);
  });

  it("should return 200 for DELETE", async () => {
    const res = await t.fetch("/mcp", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("should support dynamic options via function", async () => {
    t.app.all(
      "/mcp-dynamic",
      defineMcpHandler((event) => ({
        name: "dynamic-server",
        version: "2.0.0",
        tools: [echoTool],
      })),
    );

    const res = await t.fetch("/mcp-dynamic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("dynamic-server");
    expect(body.result.serverInfo.version).toBe("2.0.0");
  });
});
