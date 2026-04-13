#!/usr/bin/env node

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sidecarPath = path.resolve(currentDir, "./aura-control-plane-mcp.mjs");
const fakeServerPath = path.resolve(currentDir, "./lib/fake-workspace-mcp-server.mjs");
const workspacePath = path.resolve(currentDir, "../");

function jsonResponse(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startMockApi() {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/orgs/org-1/tool-actions") {
      return jsonResponse(res, 200, {
        tools: [
          {
            name: "mcp_mcp_1__echo_secret",
            description: "[GitHub MCP] Echo secret",
            inputSchema: { type: "object", properties: { message: { type: "string" } } },
            endpoint: "/api/orgs/org-1/tool-actions/mcp/mcp-1?tool_name=echo_secret",
            sourceKind: "mcp",
            trustClass: "trusted_mcp",
          },
          {
            name: "mcp_mcp_1__echo_context",
            description: "[GitHub MCP] Echo context",
            inputSchema: { type: "object" },
            endpoint: "/api/orgs/org-1/tool-actions/mcp/mcp-1?tool_name=echo_context",
            sourceKind: "mcp",
            trustClass: "trusted_mcp",
          },
        ],
      });
    }

    if (req.method === "POST" && req.url === "/api/orgs/org-1/tool-actions/mcp/mcp-1?tool_name=echo_secret") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        jsonResponse(res, 200, {
          content: [{ type: "text", text: JSON.stringify({ message: parsed.message, secret: "secret-123" }) }],
        });
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/orgs/org-1/tool-actions/mcp/mcp-1?tool_name=echo_context") {
      return jsonResponse(res, 200, {
        content: [{ type: "text", text: JSON.stringify({ cwd: workspacePath, argv: [workspacePath] }) }],
      });
    }

    jsonResponse(res, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "mock API server should have a bound address");

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function main() {
  const { server, baseUrl } = await startMockApi();
  const client = new Client({
    name: "dynamic-mcp-smoke-test",
    version: "0.1.0",
  });

  try {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [sidecarPath],
      env: {
        AURA_MCP_API_BASE_URL: baseUrl,
        AURA_MCP_PROJECT_ID: "proj-1",
        AURA_MCP_JWT: "test-jwt",
        AURA_MCP_ORG_ID: "org-1",
        AURA_MCP_PROJECT_WORKSPACE: workspacePath,
      },
      stderr: "pipe",
    });

    await client.connect(transport);

    const listResult = await client.listTools();
    const dynamicTool = listResult.tools.find((tool) => tool.name === "mcp_mcp_1__echo_secret");
    assert(dynamicTool, "expected dynamic MCP tool to be registered through the sidecar");

    const callResult = await client.callTool({
      name: dynamicTool.name,
      arguments: { message: "hello" },
    });
    assert.ok(!callResult.isError, "dynamic MCP tool call should succeed");

    const text = callResult.content?.find((item) => item.type === "text")?.text;
    assert(text, "dynamic MCP tool should return a text payload");
    const parsed = JSON.parse(text);
    assert.equal(parsed.message, "hello");
    assert.equal(parsed.secret, "secret-123");

    const contextTool = listResult.tools.find((tool) => tool.name === "mcp_mcp_1__echo_context");
    assert(contextTool, "expected context MCP tool to be registered through the sidecar");

    const contextResult = await client.callTool({
      name: contextTool.name,
      arguments: {},
    });
    assert.ok(!contextResult.isError, "context MCP tool call should succeed");
    const contextText = contextResult.content?.find((item) => item.type === "text")?.text;
    assert(contextText, "context tool should return a text payload");
    const context = JSON.parse(contextText);
    assert.equal(context.cwd, workspacePath);
    assert.deepEqual(context.argv, [workspacePath]);
  } finally {
    await Promise.allSettled([client.close(), new Promise((resolve) => server.close(resolve))]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
