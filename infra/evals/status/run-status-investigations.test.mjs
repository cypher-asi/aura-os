import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "infra/evals/status/run-status-investigations.mjs");

test("run-status-investigations sends evidence packets and verifier context to the investigator", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-investigations-"));
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Remote agent creation blocked by missing agent id",
                confidence: "high",
                summary: "The latest remote agent create check failed its expected-output contract.",
                rootCause: "The check did not produce agentId or remoteState evidence after POST /api/agents failed.",
                proof: [
                  "expected-output.missing-required-evidence lists agentId and remoteState.",
                ],
                possibleCauses: [
                  "The agent creation route rejected the request before an agent record was created.",
                ],
                reproductionSteps: [
                  {
                    label: "Run remote agent create",
                    command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes",
                  },
                ],
                affectedAreas: [
                  {
                    label: "Remote agent creation",
                    reason: "The failing check depends on POST /api/agents returning an agent id.",
                  },
                ],
                whatWouldDisproveThis: [
                  "A rerun captures agentId and remoteState with the same credentials.",
                ],
                recommendedVerifierProbes: [
                  {
                    label: "Rerun remote agent create",
                    command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes",
                    reason: "This confirms whether the expected-output contract is still missing agent evidence.",
                  },
                ],
                recommendedNextActions: [
                  "Inspect the POST /api/agents response body and status.",
                ],
                followUpEvals: [
                  "remote-agent-quota-headroom",
                ],
              }),
            },
          },
        ],
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const checksFile = path.join(tempDir, "checks.json");
    const registryFile = path.join(tempDir, "features.json");
    const expectationsFile = path.join(tempDir, "check-expectations.json");
    const outFile = path.join(tempDir, "investigations.json");

    await mkdir(tempDir, { recursive: true });
    await writeFile(registryFile, JSON.stringify({
      features: [
        {
          id: "remote-agents",
          label: "Remote Agents",
          category: "agents",
          checks: [{ id: "remote-agent-create", required: true }],
        },
      ],
    }));
    await writeFile(expectationsFile, JSON.stringify({
      checks: {
        "remote-agent-create": {
          requiredEvidence: ["orgId", "agentId", "remoteState"],
        },
      },
    }));
    await writeFile(checksFile, JSON.stringify({
      generatedAt: "2026-06-14T08:10:00.000Z",
      checks: [
        {
          checkId: "remote-agent-create",
          featureId: "remote-agents",
          status: "pass",
          message: "created",
          endedAt: "2026-06-14T06:10:00.000Z",
          evidence: { orgId: "org_123", agentId: "agent_123", remoteState: "ready" },
        },
        {
          checkId: "remote-agent-create",
          featureId: "remote-agents",
          status: "fail",
          message: "POST /api/agents failed with 409",
          endedAt: "2026-06-14T08:10:00.000Z",
          evidence: { orgId: "org_123" },
        },
      ],
    }));

    const result = await runNode([
      script,
      "--checks-file",
      checksFile,
      "--registry",
      registryFile,
      "--expectations",
      expectationsFile,
      "--out-file",
      outFile,
      "--provider",
      "openai-compatible",
      "--base-url",
      `http://127.0.0.1:${port}`,
      "--api-key",
      "test-key",
      "--model",
      "mock-investigator",
      "--max-checks",
      "1",
    ], {
      ...process.env,
      AURA_STATUS_INVESTIGATOR_SOURCE_HINTS: "0",
      AURA_STATUS_INVESTIGATOR_SOURCE_CONTEXT: "0",
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Wrote 1 investigation/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/chat/completions");
    assert.equal(requests[0].authorization, "Bearer test-key");
    assert.equal(requests[0].body.model, "mock-investigator");
    const userMessage = requests[0].body.messages.find((message) => message.role === "user");
    const input = JSON.parse(userMessage.content);
    assert.equal(input.investigationPacket.packetKind, "aura-observability-investigation-packet");
    assert.ok(input.investigationPacket.evidenceItems.some((item) => item.id === "expected-output.missing-required-evidence"));
    assert.deepEqual(input.investigationPacket.checkContract.missingRequiredEvidence, ["agentId", "remoteState"]);
    assert.deepEqual(input.verifierContext.contract.missingRequiredEvidence, ["agentId", "remoteState"]);
    assert.equal(input.verifierContext.history.currentlyRegressedFromPass, true);
    assert.ok(input.verifierContext.recommendedVerifierProbes.some((probe) => probe.label === "Compare with the most recent passing run"));

    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.investigations.length, 1);
    assert.equal(payload.investigations[0].whatWouldDisproveThis[0], "A rerun captures agentId and remoteState with the same credentials.");
    assert.equal(payload.investigations[0].recommendedVerifierProbes[0].label, "Rerun remote agent create");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
