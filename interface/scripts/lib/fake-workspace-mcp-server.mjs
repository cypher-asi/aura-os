#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "fake-workspace-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo_secret",
      description: "Returns the provided message along with the injected secret for smoke testing.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "echo_context",
      description: "Returns the worker cwd and argv context for smoke testing template expansion.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo_context") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            cwd: process.cwd(),
            argv: process.argv.slice(2),
          }),
        },
      ],
    };
  }

  if (request.params.name !== "echo_secret") {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    };
  }

  const message = typeof request.params.arguments?.message === "string"
    ? request.params.arguments.message
    : "";

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message,
          secret: process.env.TEST_MCP_SECRET ?? null,
        }),
      },
    ],
  };
});

await server.connect(new StdioServerTransport());
