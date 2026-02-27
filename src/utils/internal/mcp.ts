import type { H3Event } from "../../event.ts";
import type { JsonRpcMethod, JsonRpcRequest } from "../json-rpc.ts";
import type { McpHandlerOptions } from "../mcp.ts";
import { processJsonRpcBody, createJsonRpcError, createMethodMap } from "../json-rpc.ts";
import { HTTPError } from "../../error.ts";

const MCP_PROTOCOL_VERSION = "2025-03-26";

export async function handleMcpRequest(
  options: McpHandlerOptions,
  event: H3Event,
): Promise<Response> {
  const method = event.req.method;

  if (method === "DELETE") {
    return new Response(null, { status: 200 });
  }

  if (method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST, DELETE" },
    });
  }

  const methods = buildMcpMethodMap(options);
  const methodMap = createMethodMap(methods);

  let body: unknown;
  try {
    body = await event.req.json();
  } catch {
    return new Response(JSON.stringify(createJsonRpcError(null, -32_700, "Parse error")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await processJsonRpcBody(body, methodMap, event);

  if (result === undefined) {
    return new Response(null, { status: 202 });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// --- Internal helpers ---

function buildMcpMethodMap(options: McpHandlerOptions): Record<string, JsonRpcMethod> {
  const methods: Record<string, JsonRpcMethod> = {};

  // initialize
  methods["initialize"] = () => {
    const capabilities: Record<string, unknown> = {};
    if (options.tools?.length) {
      capabilities.tools = {};
    }
    if (options.resources?.length) {
      capabilities.resources = {};
    }
    if (options.prompts?.length) {
      capabilities.prompts = {};
    }
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: options.name, version: options.version },
      capabilities,
    };
  };

  // ping
  methods["ping"] = () => ({});

  // notifications/initialized (no-op, handled as notification by JSON-RPC layer)
  methods["notifications/initialized"] = () => undefined;

  // tools
  if (options.tools?.length) {
    const tools = options.tools;

    methods["tools/list"] = () => ({
      tools: tools.map((tool) => {
        const entry: Record<string, unknown> = {
          name: tool.name,
          inputSchema: tool.inputSchema ?? { type: "object" },
        };
        if (tool.title !== undefined) entry.title = tool.title;
        if (tool.description !== undefined) entry.description = tool.description;
        if (tool.annotations !== undefined) entry.annotations = tool.annotations;
        return entry;
      }),
    });

    methods["tools/call"] = async (req: JsonRpcRequest, event: H3Event) => {
      const params = req.params as Record<string, unknown> | undefined;
      const name = params?.name as string;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;

      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        throw new HTTPError({ status: 404, message: `Tool not found: ${name}` });
      }

      if (tool.inputSchema) {
        return await (tool.handler as (args: Record<string, unknown>, event: H3Event) => unknown)(
          args,
          event,
        );
      }
      return await (tool.handler as (event: H3Event) => unknown)(event);
    };
  }

  // resources
  if (options.resources?.length) {
    const resources = options.resources;

    methods["resources/list"] = () => ({
      resources: resources.map((r) => {
        const entry: Record<string, unknown> = {
          name: r.name,
          uri: r.uri,
        };
        if (r.title !== undefined) entry.title = r.title;
        if (r.description !== undefined) entry.description = r.description;
        if (r.mimeType !== undefined) entry.mimeType = r.mimeType;
        return entry;
      }),
    });

    methods["resources/read"] = async (req: JsonRpcRequest, event: H3Event) => {
      const params = req.params as Record<string, unknown> | undefined;
      const uriStr = params?.uri as string;
      const uri = new URL(uriStr);

      const resource = resources.find((r) => r.uri === uri.toString());
      if (!resource) {
        throw new HTTPError({ status: 404, message: `Resource not found: ${uriStr}` });
      }

      return await resource.handler(uri, event);
    };
  }

  // prompts
  if (options.prompts?.length) {
    const prompts = options.prompts;

    methods["prompts/list"] = () => ({
      prompts: prompts.map((p) => {
        const entry: Record<string, unknown> = {
          name: p.name,
        };
        if (p.title !== undefined) entry.title = p.title;
        if (p.description !== undefined) entry.description = p.description;
        if (p.args?.length) entry.arguments = p.args;
        return entry;
      }),
    });

    methods["prompts/get"] = async (req: JsonRpcRequest, event: H3Event) => {
      const params = req.params as Record<string, unknown> | undefined;
      const name = params?.name as string;
      const args = (params?.arguments ?? {}) as Record<string, string>;

      const prompt = prompts.find((p) => p.name === name);
      if (!prompt) {
        throw new HTTPError({ status: 404, message: `Prompt not found: ${name}` });
      }

      if (prompt.args?.length) {
        return await (prompt.handler as (args: Record<string, string>, event: H3Event) => unknown)(
          args,
          event,
        );
      }
      return await (prompt.handler as (event: H3Event) => unknown)(event);
    };
  }

  return methods;
}
