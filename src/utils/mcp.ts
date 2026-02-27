import { defineHandler } from "../handler.ts";
import { handleMcpRequest } from "./internal/mcp.ts";

import type { H3Event } from "../event.ts";
import type { EventHandler } from "../types/handler.ts";

// --- MCP content types ---

/**
 * MCP text content block.
 */
export interface McpTextContent {
  type: "text";
  text: string;
  annotations?: McpAnnotations;
}

/**
 * MCP image content block.
 */
export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: McpAnnotations;
}

/**
 * MCP audio content block.
 */
export interface McpAudioContent {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: McpAnnotations;
}

/**
 * MCP resource link content block.
 */
export interface McpResourceLink {
  type: "resource_link";
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  annotations?: McpAnnotations;
}

/**
 * MCP embedded resource content block.
 */
export interface McpEmbeddedResource {
  type: "resource";
  resource: McpResourceContents;
  annotations?: McpAnnotations;
}

/**
 * MCP content block union.
 */
export type McpContentBlock =
  | McpTextContent
  | McpImageContent
  | McpAudioContent
  | McpResourceLink
  | McpEmbeddedResource;

/**
 * MCP annotations for content and resources.
 */
export interface McpAnnotations {
  audience?: ("user" | "assistant")[];
  priority?: number;
  lastModified?: string;
}

// --- MCP resource types ---

/**
 * MCP text resource contents.
 */
export interface McpTextResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
}

/**
 * MCP blob resource contents.
 */
export interface McpBlobResourceContents {
  uri: string;
  mimeType?: string;
  blob: string;
}

/**
 * MCP resource contents union.
 */
export type McpResourceContents = McpTextResourceContents | McpBlobResourceContents;

// --- MCP result types ---

/**
 * Result of executing an MCP tool.
 */
export interface McpCallToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Result of reading an MCP resource.
 */
export interface McpReadResourceResult {
  contents: McpResourceContents[];
}

/**
 * MCP prompt message.
 */
export interface McpPromptMessage {
  role: "user" | "assistant";
  content: McpContentBlock;
}

/**
 * Result of getting an MCP prompt.
 */
export interface McpGetPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

// --- MCP tool types ---

/**
 * MCP tool annotations describing behavior hints.
 */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * A function that handles an MCP tool call.
 *
 * When `InputSchema` is provided, receives parsed arguments as the first parameter.
 * Always receives the `H3Event` for request context access.
 */
export type McpToolCallback<InputSchema extends Record<string, unknown> | undefined = undefined> =
  InputSchema extends Record<string, unknown>
    ? (
        args: Record<string, unknown>,
        event: H3Event,
      ) => McpCallToolResult | Promise<McpCallToolResult>
    : (event: H3Event) => McpCallToolResult | Promise<McpCallToolResult>;

/**
 * MCP tool definition.
 *
 * The `inputSchema` should be a JSON Schema object describing the tool's input parameters.
 */
export interface McpToolDefinition<
  InputSchema extends Record<string, unknown> | undefined = undefined,
> {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: InputSchema;
  annotations?: McpToolAnnotations;
  handler: McpToolCallback<InputSchema>;
}

// --- MCP resource types ---

/**
 * A function that handles reading an MCP resource.
 */
export type McpResourceCallback = (
  uri: URL,
  event: H3Event,
) => McpReadResourceResult | Promise<McpReadResourceResult>;

/**
 * MCP resource definition.
 */
export interface McpResourceDefinition {
  name: string;
  title?: string;
  description?: string;
  uri: string;
  mimeType?: string;
  handler: McpResourceCallback;
}

// --- MCP prompt types ---

/**
 * A function that handles an MCP prompt without arguments.
 */
export type McpPromptCallbackWithoutArgs = (
  event: H3Event,
) => McpGetPromptResult | Promise<McpGetPromptResult>;

/**
 * A function that handles an MCP prompt with arguments.
 */
export type McpPromptCallbackWithArgs = (
  args: Record<string, string>,
  event: H3Event,
) => McpGetPromptResult | Promise<McpGetPromptResult>;

/**
 * A function that handles an MCP prompt.
 */
export type McpPromptCallback = McpPromptCallbackWithoutArgs | McpPromptCallbackWithArgs;

/**
 * MCP prompt argument definition (for `prompts/list` response).
 */
export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * MCP prompt definition with arguments.
 */
export interface McpPromptDefinitionWithArgs {
  name: string;
  title?: string;
  description?: string;
  args: McpPromptArgument[];
  handler: McpPromptCallbackWithArgs;
}

/**
 * MCP prompt definition without arguments.
 */
export interface McpPromptDefinitionWithoutArgs {
  name: string;
  title?: string;
  description?: string;
  args?: undefined;
  handler: McpPromptCallbackWithoutArgs;
}

/**
 * MCP prompt definition.
 */
export type McpPromptDefinition = McpPromptDefinitionWithArgs | McpPromptDefinitionWithoutArgs;

// --- handler options ---

/**
 * Options for `defineMcpHandler`.
 */
export interface McpHandlerOptions {
  name: string;
  version: string;
  tools?: McpToolDefinition<any>[];
  resources?: McpResourceDefinition[];
  prompts?: McpPromptDefinition[];
}

// --- definition helpers ---

/**
 * Define an MCP tool with a name, optional JSON Schema input, and a handler function.
 *
 * @param definition - The tool definition including name, description, input schema, and handler.
 * @returns The same definition (identity function for type inference).
 *
 * @example
 * // Tool with input parameters
 * const echoTool = defineMcpTool({
 *   name: "echo",
 *   description: "Echo back a message",
 *   inputSchema: {
 *     type: "object",
 *     properties: { message: { type: "string" } },
 *     required: ["message"],
 *   },
 *   handler: async (args, event) => ({
 *     content: [{ type: "text", text: args.message as string }],
 *   }),
 * });
 *
 * @example
 * // Tool without input parameters
 * const pingTool = defineMcpTool({
 *   name: "ping",
 *   description: "Returns pong",
 *   handler: async (event) => ({
 *     content: [{ type: "text", text: "pong" }],
 *   }),
 * });
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
export function defineMcpTool<
  const InputSchema extends Record<string, unknown> | undefined = undefined,
>(definition: McpToolDefinition<InputSchema>): McpToolDefinition<InputSchema> {
  return definition;
}

/**
 * Define an MCP resource with a static URI and a handler that returns its contents.
 *
 * @param definition - The resource definition including name, URI, and handler.
 * @returns The same definition (identity function for type inference).
 *
 * @example
 * const readmeResource = defineMcpResource({
 *   name: "readme",
 *   uri: "file:///readme",
 *   description: "Project README",
 *   mimeType: "text/markdown",
 *   handler: async (uri, event) => ({
 *     contents: [{ uri: uri.toString(), text: "# My Project" }],
 *   }),
 * });
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/resources
 */
export function defineMcpResource(definition: McpResourceDefinition): McpResourceDefinition {
  return definition;
}

/**
 * Define an MCP prompt with optional arguments and a handler that returns messages.
 *
 * @param definition - The prompt definition including name, argument definitions, and handler.
 * @returns The same definition (identity function for type inference).
 *
 * @example
 * // Prompt with arguments
 * const greetPrompt = defineMcpPrompt({
 *   name: "greet",
 *   description: "Generate a greeting",
 *   args: [{ name: "name", required: true }],
 *   handler: async (args, event) => ({
 *     messages: [
 *       { role: "user", content: { type: "text", text: `Hello ${args.name}!` } },
 *     ],
 *   }),
 * });
 *
 * @example
 * // Prompt without arguments
 * const helpPrompt = defineMcpPrompt({
 *   name: "help",
 *   description: "Show help information",
 *   handler: async (event) => ({
 *     messages: [
 *       { role: "user", content: { type: "text", text: "How can I help?" } },
 *     ],
 *   }),
 * });
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
 */
export function defineMcpPrompt(definition: McpPromptDefinition): McpPromptDefinition {
  return definition;
}

/**
 * Define an H3 event handler that implements the Model Context Protocol (MCP)
 * over HTTP using JSON-RPC 2.0 as the wire format.
 *
 * Supports MCP methods: `initialize`, `ping`, `tools/list`, `tools/call`,
 * `resources/list`, `resources/read`, `prompts/list`, `prompts/get`,
 * and `notifications/initialized`.
 *
 * @param options - Static options or a function that receives the `H3Event` and returns options (for per-request configuration).
 * @returns An H3 `EventHandler`.
 *
 * @example
 * app.all(
 *   "/mcp",
 *   defineMcpHandler({
 *     name: "my-server",
 *     version: "1.0.0",
 *     tools: [echoTool],
 *     resources: [readmeResource],
 *     prompts: [greetPrompt],
 *   }),
 * );
 *
 * @example
 * // Dynamic options based on request context
 * app.all(
 *   "/mcp",
 *   defineMcpHandler((event) => ({
 *     name: "my-server",
 *     version: "1.0.0",
 *     tools: getToolsForUser(event),
 *   })),
 * );
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
