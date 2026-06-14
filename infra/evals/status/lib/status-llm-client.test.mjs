import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  callAnthropicTool,
  callOpenAiCompatibleJson,
} from "./status-llm-client.mjs";

test("callOpenAiCompatibleJson posts chat completions and returns message content", async () => {
  const requests = [];
  const server = await createMockServer((request, body, response) => {
    requests.push({ url: request.url, body: JSON.parse(body) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }));
  });
  try {
    const content = await callOpenAiCompatibleJson({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKey: "test-key",
      model: "mock-openai",
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 5_000,
      requestLabel: "Unit test",
    });

    assert.equal(content, "{\"ok\":true}");
    assert.equal(requests[0].url, "/chat/completions");
    assert.equal(requests[0].body.response_format.type, "json_object");
  } finally {
    await server.close();
  }
});

test("callAnthropicTool forces the requested tool and returns tool input", async () => {
  const requests = [];
  const server = await createMockServer((request, body, response) => {
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      content: [
        {
          type: "tool_use",
          name: "record_test",
          input: { ok: true },
        },
      ],
    }));
  });
  try {
    const content = await callAnthropicTool({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKey: "anthropic-key",
      model: "mock-claude",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "hello" },
      ],
      timeoutMs: 5_000,
      maxTokens: 100,
      tool: {
        name: "record_test",
        description: "Record a test payload.",
        input_schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      },
      requestLabel: "Anthropic unit test",
    });

    assert.deepEqual(content, { ok: true });
    assert.equal(requests[0].url, "/messages");
    assert.equal(requests[0].headers["x-api-key"], "anthropic-key");
    assert.equal(requests[0].body.system, "system prompt");
    assert.equal(requests[0].body.tool_choice.name, "record_test");
    assert.equal(requests[0].body.tools[0].name, "record_test");
  } finally {
    await server.close();
  }
});

async function createMockServer(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      handler(request, body, response);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
