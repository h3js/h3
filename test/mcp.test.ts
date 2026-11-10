import { describe, it, expect, beforeEach, vi } from "vitest";
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
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      handler: async ({ message }) => ({
        content: [{ type: "text" as const, text: message as string }],
      }),
    });
    expect(tool.name).toBe("with-schema");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema!.type).toBe("object");
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

  it("should preserve args", () => {
    const prompt = defineMcpPrompt({
      name: "with-args",
      args: [{ name: "name", required: true }],
      handler: async (args: Record<string, string>) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: `Hello ${args.name}!` },
          },
        ],
      }),
    });
    expect(prompt.args).toBeDefined();
    expect(prompt.args![0].name).toBe("name");
  });
});

// ---- MCP Handler (integration tests) ----

describeMatrix("defineMcpHandler", (t, { it, expect }) => {
  const echoTool = defineMcpTool({
    name: "echo",
    description: "Echo back a message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    handler: async ({ message }) => ({
      content: [{ type: "text" as const, text: message as string }],
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
    args: [{ name: "name", required: true }],
    handler: async (args: Record<string, string>) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: `Hello ${args.name}!` },
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
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("test-server");
    expect(body.result.serverInfo.version).toBe("1.0.0");
    expect(body.result.capabilities).toBeDefined();
  });

  it("should handle tools/list", async () => {
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
    const res = await jsonRpc("tools/call", { name: "greet" }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content).toEqual([{ type: "text", text: "Hello!" }]);
  });

  it("should handle resources/list", async () => {
    const res = await jsonRpc("resources/list", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.resources).toBeDefined();
    expect(body.result.resources.length).toBe(1);
    expect(body.result.resources[0].name).toBe("readme");
    expect(body.result.resources[0].uri).toBe("file:///readme");
  });

  it("should handle resources/read", async () => {
    const res = await jsonRpc("resources/read", { uri: "file:///readme" }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.contents).toBeDefined();
    expect(body.result.contents[0].text).toBe("# My Project\nHello world");
  });

  it("should handle prompts/list", async () => {
    const res = await jsonRpc("prompts/list", {}, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.prompts).toBeDefined();
    expect(body.result.prompts.length).toBe(1);
    expect(body.result.prompts[0].name).toBe("greet");
  });

  it("should handle prompts/get", async () => {
    const res = await jsonRpc("prompts/get", { name: "greet", arguments: { name: "World" } }, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.messages).toBeDefined();
    expect(body.result.messages[0].content.text).toBe("Hello World!");
  });

  it("should handle ping", async () => {
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

  it("should include title and instructions in initialize", async () => {
    t.app.all(
      "/mcp-full",
      defineMcpHandler({
        name: "full-server",
        version: "1.0.0",
        title: "Full Server Display Name",
        instructions: "Use this server for testing",
        tools: [echoTool],
      }),
    );

    const res = await t.fetch("/mcp-full", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    const body = await res.json();
    expect(body.result.serverInfo.title).toBe("Full Server Display Name");
    expect(body.result.instructions).toBe("Use this server for testing");
  });

  it("should not include title/instructions when not set", async () => {
    const res = await jsonRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    const body = await res.json();
    expect(body.result.serverInfo.title).toBeUndefined();
    expect(body.result.instructions).toBeUndefined();
  });

  it("should reject unsupported MCP-Protocol-Version header", async () => {
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "9999-01-01",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should accept supported MCP-Protocol-Version header", async () => {
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    });

    expect(res.status).toBe(200);
  });

  it("should include outputSchema in tools/list", async () => {
    const toolWithOutput = defineMcpTool({
      name: "structured",
      description: "Returns structured data",
      outputSchema: {
        type: "object",
        properties: { result: { type: "string" } },
      },
      handler: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        structuredContent: { result: "ok" },
      }),
    });

    t.app.all(
      "/mcp-output",
      defineMcpHandler({
        name: "output-server",
        version: "1.0.0",
        tools: [toolWithOutput],
      }),
    );

    const res = await t.fetch("/mcp-output", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const body = await res.json();
    expect(body.result.tools[0].outputSchema).toEqual({
      type: "object",
      properties: { result: { type: "string" } },
    });
  });

  it("should include size in resources/list", async () => {
    const sizedResource = defineMcpResource({
      name: "sized",
      uri: "file:///sized",
      size: 1024,
      handler: async (uri) => ({
        contents: [{ uri: uri.toString(), text: "data" }],
      }),
    });

    t.app.all(
      "/mcp-sized",
      defineMcpHandler({
        name: "sized-server",
        version: "1.0.0",
        resources: [sizedResource],
      }),
    );

    const res = await t.fetch("/mcp-sized", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      }),
    });

    const body = await res.json();
    expect(body.result.resources[0].size).toBe(1024);
  });

  it("should support dynamic options via function", async () => {
    t.app.all(
      "/mcp-dynamic",
      defineMcpHandler(() => ({
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
          protocolVersion: "2025-06-18",
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

// ---- Lazy options (integration tests) ----

describeMatrix("defineMcpHandler (lazy options)", (t, { it, expect }) => {
  const echoTool = defineMcpTool({
    name: "echo",
    description: "Echo back a message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    handler: async ({ message }) => ({
      content: [{ type: "text" as const, text: message as string }],
    }),
  });

  const readmeResource = defineMcpResource({
    name: "readme",
    uri: "file:///readme",
    description: "Project README",
    handler: async (uri) => ({
      contents: [{ uri: uri.toString(), text: "# Lazy Resource" }],
    }),
  });

  const helpPrompt = defineMcpPrompt({
    name: "help",
    description: "Show help",
    handler: async () => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: "How can I help?" },
        },
      ],
    }),
  });

  const readmeToolDummy = defineMcpTool({
    name: "dummy",
    description: "A dummy tool",
    handler: async () => ({
      content: [{ type: "text" as const, text: "dummy" }],
    }),
  });

  // Helper to send JSON-RPC requests
  function jsonRpc(path: string, method: string, params?: unknown, id: number = 1) {
    return t.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  }

  it("should resolve lazy tool items", async () => {
    const toolFn = vi.fn(async () => echoTool);
    t.app.all("/mcp-lazy", defineMcpHandler({ name: "lazy", version: "1.0.0", tools: [toolFn] }));

    const listRes = await jsonRpc("/mcp-lazy", "tools/list");
    expect((await listRes.json()).result.tools[0].name).toBe("echo");

    const callRes = await jsonRpc("/mcp-lazy", "tools/call", {
      name: "echo",
      arguments: { message: "lazy!" },
    });
    expect((await callRes.json()).result.content).toEqual([{ type: "text", text: "lazy!" }]);

    // Factory function should be called only once (cached)
    expect(toolFn).toHaveBeenCalledTimes(1);
  });

  it("should resolve lazy resource items", async () => {
    const resourceFn = vi.fn(async () => readmeResource);
    t.app.all(
      "/mcp-lazy-res",
      defineMcpHandler({ name: "lazy", version: "1.0.0", resources: [resourceFn] }),
    );

    const listRes = await jsonRpc("/mcp-lazy-res", "resources/list");
    expect((await listRes.json()).result.resources[0].name).toBe("readme");

    const readRes = await jsonRpc("/mcp-lazy-res", "resources/read", { uri: "file:///readme" });
    expect((await readRes.json()).result.contents[0].text).toBe("# Lazy Resource");

    expect(resourceFn).toHaveBeenCalledTimes(1);
  });

  it("should resolve lazy prompt items", async () => {
    const promptFn = vi.fn(async () => helpPrompt);
    t.app.all(
      "/mcp-lazy-prompt",
      defineMcpHandler({ name: "lazy", version: "1.0.0", prompts: [promptFn] }),
    );

    const listRes = await jsonRpc("/mcp-lazy-prompt", "prompts/list");
    expect((await listRes.json()).result.prompts[0].name).toBe("help");

    const getRes = await jsonRpc("/mcp-lazy-prompt", "prompts/get", { name: "help" });
    expect((await getRes.json()).result.messages[0].content.text).toBe("How can I help?");

    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  it("should resolve mixed static and lazy items", async () => {
    const lazyTool = vi.fn(async () => echoTool);
    t.app.all(
      "/mcp-lazy-mixed",
      defineMcpHandler({
        name: "lazy",
        version: "1.0.0",
        tools: [lazyTool, readmeToolDummy],
      }),
    );

    const listRes = await jsonRpc("/mcp-lazy-mixed", "tools/list");
    const tools = (await listRes.json()).result.tools;
    expect(tools.length).toBe(2);
    expect(tools[0].name).toBe("echo");
    expect(tools[1].name).toBe("dummy");
  });

  it("should report lazy capabilities in initialize", async () => {
    t.app.all(
      "/mcp-lazy-init",
      defineMcpHandler({
        name: "lazy",
        version: "1.0.0",
        tools: [async () => echoTool],
        resources: [async () => readmeResource],
        prompts: [async () => helpPrompt],
      }),
    );

    const res = await jsonRpc("/mcp-lazy-init", "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    const body = await res.json();
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.capabilities.prompts).toBeDefined();
  });
});
