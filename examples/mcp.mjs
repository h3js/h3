import { z } from "zod";
import {
  H3,
  serve,
  defineMcpHandler,
  defineMcpTool,
  defineMcpResource,
  defineMcpPrompt,
} from "h3";

export const app = new H3();

// --- Define MCP tools ---

const echoTool = defineMcpTool({
  name: "echo",
  description: "Echo back a message",
  inputSchema: { message: z.string().describe("The message to echo") },
  handler: async ({ message }) => ({
    content: [{ type: "text", text: message }],
  }),
});

const calculatorTool = defineMcpTool({
  name: "calculator",
  description: "Perform basic math operations",
  inputSchema: {
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  },
  handler: async ({ operation, a, b }) => {
    let result;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        result = b !== 0 ? a / b : "Error: Division by zero";
        break;
    }
    return {
      content: [
        { type: "text", text: JSON.stringify({ operation, a, b, result }, null, 2) },
      ],
    };
  },
});

// --- Define MCP resources ---

const aboutResource = defineMcpResource({
  name: "about",
  uri: "file:///about",
  description: "Information about this MCP server",
  handler: async (uri) => ({
    contents: [
      {
        uri: uri.toString(),
        text: "This is an example MCP server built with h3.",
      },
    ],
  }),
});

// --- Define MCP prompts ---

const summarizePrompt = defineMcpPrompt({
  name: "summarize",
  description: "Generate a prompt to summarize text",
  argsSchema: {
    text: z.string().describe("The text to summarize"),
  },
  handler: async ({ text }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please summarize the following text:\n\n${text}`,
        },
      },
    ],
  }),
});

// --- Create the MCP handler ---

app.all(
  "/mcp",
  defineMcpHandler({
    name: "h3-mcp-example",
    version: "1.0.0",
    tools: [echoTool, calculatorTool],
    resources: [aboutResource],
    prompts: [summarizePrompt],
  }),
);

// --- Landing page ---

app.get("/", () => "MCP server running at /mcp");

serve(app);
