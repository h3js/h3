import type { H3Event } from "../../event.ts";
import type { JsonRpcMethod, JsonRpcRequest } from "../json-rpc.ts";
import type { MaybeLazy, McpHandlerOptions } from "../mcp.ts";
import type { McpToolDefinition, McpResourceDefinition, McpPromptDefinition } from "../mcp.ts";
import { processJsonRpcBody, createJsonRpcError, createMethodMap } from "../json-rpc.ts";
import { HTTPError } from "../../error.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);

export interface McpResolvedOptions {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
  tools: () => Promise<McpToolDefinition<any>[] | undefined>;
  resources: () => Promise<McpResourceDefinition[] | undefined>;
  prompts: () => Promise<McpPromptDefinition[] | undefined>;
}

export function resolveMcpOptions(options: McpHandlerOptions): McpResolvedOptions {
  return {
    name: options.name,
    version: options.version,
    title: options.title,
    instructions: options.instructions,
    tools: _resolveLazyArray(options.tools),
    resources: _resolveLazyArray(options.resources),
    prompts: _resolveLazyArray(options.prompts),
  };
}

export async function handleMcpRequest(
  options: McpResolvedOptions,
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

  const protocolVersion = event.req.headers.get("mcp-protocol-version");
  if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
    return new Response(`Unsupported MCP protocol version: ${protocolVersion}`, {
      status: 400,
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

function _resolveLazyArray<T>(items: MaybeLazy<T>[] | undefined): () => Promise<T[] | undefined> {
  if (!items?.length) {
    return () => Promise.resolve(undefined);
  }
  let cached: Promise<T[]> | undefined;
  return () => {
    if (!cached) {
      cached = Promise.all(
        items.map((item) => (typeof item === "function" ? (item as () => T | Promise<T>)() : item)),
      );
    }
    return cached;
  };
}

function buildMcpMethodMap(options: McpResolvedOptions): Record<string, JsonRpcMethod> {
  const methods: Record<string, JsonRpcMethod> = {};

  // initialize
  methods["initialize"] = async () => {
    const capabilities: Record<string, unknown> = {};
    const [tools, resources, prompts] = await Promise.all([
      options.tools(),
      options.resources(),
      options.prompts(),
    ]);
    if (tools?.length) {
      capabilities.tools = {};
    }
    if (resources?.length) {
      capabilities.resources = {};
    }
    if (prompts?.length) {
      capabilities.prompts = {};
    }
    const serverInfo: Record<string, string> = {
      name: options.name,
      version: options.version,
    };
    if (options.title !== undefined) {
      serverInfo.title = options.title;
    }
    const result: Record<string, unknown> = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo,
      capabilities,
    };
    if (options.instructions !== undefined) {
      result.instructions = options.instructions;
    }
    return result;
  };

  // ping
  methods["ping"] = () => ({});

  // notifications/initialized (no-op, handled as notification by JSON-RPC layer)
  methods["notifications/initialized"] = () => undefined;

  // tools
  methods["tools/list"] = async () => {
    const tools = await options.tools();
    return {
      tools: (tools ?? []).map((tool) => {
        const entry: Record<string, unknown> = {
          name: tool.name,
          inputSchema: tool.inputSchema ?? { type: "object" },
        };
        if (tool.title !== undefined) entry.title = tool.title;
        if (tool.description !== undefined) entry.description = tool.description;
        if (tool.outputSchema !== undefined) entry.outputSchema = tool.outputSchema;
        if (tool.annotations !== undefined) entry.annotations = tool.annotations;
        return entry;
      }),
    };
  };

  methods["tools/call"] = async (req: JsonRpcRequest, event: H3Event) => {
    const tools = await options.tools();
    const params = req.params as Record<string, unknown> | undefined;
    const name = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    const tool = tools?.find((t) => t.name === name);
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

  // resources
  methods["resources/list"] = async () => {
    const resources = await options.resources();
    return {
      resources: (resources ?? []).map((r) => {
        const entry: Record<string, unknown> = {
          name: r.name,
          uri: r.uri,
        };
        if (r.title !== undefined) entry.title = r.title;
        if (r.description !== undefined) entry.description = r.description;
        if (r.mimeType !== undefined) entry.mimeType = r.mimeType;
        if (r.size !== undefined) entry.size = r.size;
        return entry;
      }),
    };
  };

  methods["resources/read"] = async (req: JsonRpcRequest, event: H3Event) => {
    const resources = await options.resources();
    const params = req.params as Record<string, unknown> | undefined;
    const uriStr = params?.uri as string;
    const uri = new URL(uriStr);

    const resource = resources?.find((r) => r.uri === uri.toString());
    if (!resource) {
      throw new HTTPError({ status: 404, message: `Resource not found: ${uriStr}` });
    }

    return await resource.handler(uri, event);
  };

  // prompts
  methods["prompts/list"] = async () => {
    const prompts = await options.prompts();
    return {
      prompts: (prompts ?? []).map((p) => {
        const entry: Record<string, unknown> = {
          name: p.name,
        };
        if (p.title !== undefined) entry.title = p.title;
        if (p.description !== undefined) entry.description = p.description;
        if (p.args?.length) entry.arguments = p.args;
        return entry;
      }),
    };
  };

  methods["prompts/get"] = async (req: JsonRpcRequest, event: H3Event) => {
    const prompts = await options.prompts();
    const params = req.params as Record<string, unknown> | undefined;
    const name = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, string>;

    const prompt = prompts?.find((p) => p.name === name);
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

  return methods;
}
