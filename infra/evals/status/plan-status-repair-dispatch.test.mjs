import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "infra/evals/status/plan-status-repair-dispatch.mjs");

test("plan-status-repair-dispatch selects investigated high-confidence failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-repair-dispatch-"));
  try {
    const files = await writeFixture(tempDir);
    const outFile = path.join(tempDir, "dispatch-plan.json");
    const githubOutput = path.join(tempDir, "github-output.txt");
    const result = await runNode([
      script,
      "--checks-file",
      files.checksFile,
      "--investigations-file",
      files.investigationsFile,
      "--out-file",
      outFile,
      "--github-output",
      githubOutput,
      "--min-confidence",
      "medium",
      "--max-checks",
      "2",
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /dispatch remote-agent-create/);
    const plan = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(plan.shouldDispatch, true);
    assert.deepEqual(plan.checks, ["remote-agent-create"]);
    assert.equal(plan.selected[0].investigationConfidence, "high");
    const output = await readFile(githubOutput, "utf8");
    assert.match(output, /should_dispatch=true/);
    assert.match(output, /checks=remote-agent-create/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("plan-status-repair-dispatch does not dispatch low-confidence failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-repair-dispatch-"));
  try {
    const files = await writeFixture(tempDir, { confidence: "low" });
    const outFile = path.join(tempDir, "dispatch-plan.json");
    const result = await runNode([
      script,
      "--checks-file",
      files.checksFile,
      "--investigations-file",
      files.investigationsFile,
      "--out-file",
      outFile,
      "--min-confidence",
      "medium",
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /no eligible failures/);
    const plan = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(plan.shouldDispatch, false);
    assert.deepEqual(plan.checks, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function writeFixture(tempDir, { confidence = "high" } = {}) {
  await mkdir(tempDir, { recursive: true });
  const checksFile = path.join(tempDir, "checks.json");
  const investigationsFile = path.join(tempDir, "investigations.json");
  await writeFile(checksFile, JSON.stringify({
    generatedAt: "2026-06-14T08:10:00.000Z",
    checks: [
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "fail",
        message: "POST /api/agents failed",
        endedAt: "2026-06-14T08:10:00.000Z",
      },
      {
        checkId: "harness-health",
        featureId: "marketplace-bootstrap",
        status: "pass",
        message: "ok",
        endedAt: "2026-06-14T08:10:00.000Z",
      },
    ],
  }, null, 2));
  await writeFile(investigationsFile, JSON.stringify({
    generatedAt: "2026-06-14T08:10:10.000Z",
    investigations: [
      {
        id: "remote-agents:remote-agent-create:abc123",
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "ready",
        confidence,
        title: "Remote agent creation blocked",
        summary: "Creation failed.",
        rootCause: "POST /api/agents failed.",
        proof: ["expected-output.missing-required-evidence lists agentId."],
      },
    ],
  }, null, 2));
  return { checksFile, investigationsFile };
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
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
