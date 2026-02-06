import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  ToolAnnotations,
  ServerRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ResourceTemplate, ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ZodRawShapeCompat,
  ShapeOutput,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { defineHandler } from "../handler.ts";
import { handleMcpRequest } from "./internal/mcp.ts";

import type { H3Event } from "../event.ts";
import type { EventHandler } from "../types/handler.ts";

// --- tool types ---

export type McpToolCallback<Args extends ZodRawShapeCompat | undefined = undefined> =
  Args extends ZodRawShapeCompat
    ? (
        args: ShapeOutput<Args>,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => CallToolResult | Promise<CallToolResult>
    : (
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => CallToolResult | Promise<CallToolResult>;

export interface McpToolDefinition<
  InputSchema extends ZodRawShapeCompat | undefined = undefined,
  OutputSchema extends ZodRawShapeCompat | undefined = undefined,
> {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: InputSchema;
  outputSchema?: OutputSchema;
  annotations?: ToolAnnotations;
  handler: McpToolCallback<InputSchema>;
}

// --- resource types ---

export type McpResourceCallback = (
  uri: URL,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ReadResourceResult | Promise<ReadResourceResult>;

export type McpResourceTemplateCallback = (
  uri: URL,
  variables: Record<string, string | undefined>,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ReadResourceResult | Promise<ReadResourceResult>;

export interface McpResourceDefinition {
  name: string;
  title?: string;
  description?: string;
  uri: string | ResourceTemplate;
  metadata?: ResourceMetadata;
  handler: McpResourceCallback | McpResourceTemplateCallback;
}

// --- prompt types ---

export type McpPromptCallback<Args extends ZodRawShapeCompat | undefined = undefined> =
  Args extends ZodRawShapeCompat
    ? (
        args: ShapeOutput<Args>,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => GetPromptResult | Promise<GetPromptResult>
    : (
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => GetPromptResult | Promise<GetPromptResult>;

export interface McpPromptDefinition<Args extends ZodRawShapeCompat | undefined = undefined> {
  name: string;
  title?: string;
  description?: string;
  argsSchema?: Args;
  handler: McpPromptCallback<Args>;
}

// --- handler options ---

export interface McpHandlerOptions {
  name: string;
  version: string;
  tools?: McpToolDefinition<any, any>[];
  resources?: McpResourceDefinition[];
  prompts?: McpPromptDefinition<any>[];
}

// --- definition helpers ---

/**
 * Define an MCP tool.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
export function defineMcpTool<
  const InputSchema extends ZodRawShapeCompat | undefined = undefined,
  const OutputSchema extends ZodRawShapeCompat | undefined = undefined,
>(
  definition: McpToolDefinition<InputSchema, OutputSchema>,
): McpToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

/**
 * Define an MCP resource.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/resources
 */
export function defineMcpResource(definition: McpResourceDefinition): McpResourceDefinition {
  return definition;
}

/**
 * Define an MCP prompt.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
 */
export function defineMcpPrompt<const Args extends ZodRawShapeCompat | undefined = undefined>(
  definition: McpPromptDefinition<Args>,
): McpPromptDefinition<Args> {
  return definition;
}

/**
 * Define an MCP event handler.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 */
export function defineMcpHandler(
  options: McpHandlerOptions | ((event: H3Event) => McpHandlerOptions),
): EventHandler {
  return defineHandler(function _mcpHandler(event) {
    const resolvedOptions = typeof options === "function" ? options(event) : options;
    return handleMcpRequest(resolvedOptions, event);
  });
}
