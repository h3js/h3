import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { H3Event } from "../../event.ts";
import type { McpHandlerOptions } from "../mcp.ts";
import { readBody } from "../body.ts";

/**
 * Web-standard MCP transport implementing the SDK's Transport interface.
 */
export class H3McpTransport implements Transport {
  private _responseResolver: ((messages: JSONRPCMessage[]) => void) | null = null;
  private _expectedResponses = 0;
  private _collectedResponses: JSONRPCMessage[] = [];

  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
  sessionId?: string;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this._collectedResponses.push(message);
    if (this._responseResolver && this._collectedResponses.length >= this._expectedResponses) {
      this._responseResolver(this._collectedResponses);
      this._responseResolver = null;
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  processRequest(messages: JSONRPCMessage | JSONRPCMessage[]): Promise<JSONRPCMessage[]> {
    const messageList = Array.isArray(messages) ? messages : [messages];

    // count requests that expect responses (notifications have no "id")
    this._expectedResponses = 0;
    for (const msg of messageList) {
      if ("id" in msg && (msg as { id?: RequestId }).id !== undefined) {
        this._expectedResponses++;
      }
    }

    // all notifications, no responses expected
    if (this._expectedResponses === 0) {
      for (const msg of messageList) {
        this.onmessage?.(msg);
      }
      return Promise.resolve([]);
    }

    this._collectedResponses = [];

    return new Promise<JSONRPCMessage[]>((resolve) => {
      this._responseResolver = resolve;
      for (const msg of messageList) {
        this.onmessage?.(msg);
      }
    });
  }
}

export async function createMcpServer(options: McpHandlerOptions): Promise<McpServer> {
  const { McpServer: McpServerClass } =
    (await import("@modelcontextprotocol/sdk/server/mcp.js")) as { McpServer: typeof McpServer };

  const server = new McpServerClass({
    name: options.name,
    version: options.version,
  });

  if (options.tools) {
    for (const tool of options.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        },
        tool.handler as any,
      );
    }
  }

  if (options.resources) {
    for (const resource of options.resources) {
      server.registerResource(
        resource.name,
        resource.uri as any,
        {
          title: resource.title,
          description: resource.description,
          ...resource.metadata,
        },
        resource.handler as any,
      );
    }
  }

  if (options.prompts) {
    for (const prompt of options.prompts) {
      server.registerPrompt(
        prompt.name,
        {
          title: prompt.title,
          description: prompt.description,
          argsSchema: prompt.argsSchema,
        },
        prompt.handler as any,
      );
    }
  }

  return server;
}

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

  const server = await createMcpServer(options);
  const transport = new H3McpTransport();

  await server.connect(transport);

  try {
    const body = (await readBody(event)) as JSONRPCMessage | JSONRPCMessage[];
    const isBatch = Array.isArray(body);
    const responses = await transport.processRequest(body);

    await server.close();

    if (responses.length === 0) {
      return new Response(null, { status: 202 });
    }

    const responseBody = isBatch ? JSON.stringify(responses) : JSON.stringify(responses[0]);

    return new Response(responseBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    await server.close();
    throw error;
  }
}
