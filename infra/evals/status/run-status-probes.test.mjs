import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const runnerPath = path.join(__dirname, "run-status-probes.mjs");

test("status probe cleanup removes project bindings before deleting created agents", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "aura-status-probes-"));
  const requests = [];
  let bindingRemoved = false;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${url.pathname}`);

    if (req.method === "GET" && url.pathname === "/api/orgs") {
      return sendJson(res, 200, [{ id: "org-1" }]);
    }

    if (req.method === "POST" && url.pathname === "/api/agents") {
      await readBody(req);
      return sendJson(res, 200, {
        agent_id: "agent-1",
        machine_type: "local",
        environment: "local_host",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/agents/agent-1/projects") {
      return sendJson(res, 200, [{
        project_agent_id: "project-agent-1",
        project_id: "home",
        project_name: "Home",
      }]);
    }

    if (req.method === "DELETE" && url.pathname === "/api/agents/agent-1/projects/project-agent-1") {
      bindingRemoved = true;
      res.writeHead(204).end();
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/agents/agent-1") {
      if (!bindingRemoved) {
        return sendJson(res, 409, { error: "Cannot delete agent while it is added to projects." });
      }
      res.writeHead(204).end();
      return;
    }

    sendJson(res, 404, { error: `Unhandled ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        runnerPath,
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--token",
        "test-token",
        "--checks",
        "local-agent-create",
        "--out-dir",
        path.join(tmp, "checks"),
        "--environment",
        "test",
        "--runtime-environment",
        "production-api",
      ],
      { cwd: repoRoot },
    );

    assert.match(stdout, /^pass\s+local-agent-create/m);
    assert.equal(stderr, "");
    assert.ok(bindingRemoved, "expected the project binding to be removed");

    const bindingDeleteIndex = requests.indexOf("DELETE /api/agents/agent-1/projects/project-agent-1");
    const agentDeleteIndex = requests.indexOf("DELETE /api/agents/agent-1");
    assert.ok(bindingDeleteIndex >= 0, "expected project binding delete request");
    assert.ok(agentDeleteIndex >= 0, "expected agent delete request");
    assert.ok(bindingDeleteIndex < agentDeleteIndex, "binding must be removed before deleting the agent");
  } finally {
    server.close();
    await rm(tmp, { recursive: true, force: true });
  }
});

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}
