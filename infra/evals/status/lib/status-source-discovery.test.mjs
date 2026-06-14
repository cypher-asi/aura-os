import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  discoverInvestigationSources,
  sourceNeedlesForCheck,
} from "./status-source-discovery.mjs";

const execFileAsync = promisify(execFile);

test("sourceNeedlesForCheck extracts endpoint, evidence, and naming variants", () => {
  const needles = sourceNeedlesForCheck({
    checkId: "remote-agent-create",
    featureId: "remote-agents",
    message: "SESSION_OPEN_FAILED: POST /api/agents returned 404",
    evidence: {
      remoteState: "missing",
      failedModels: ["claude-sonnet-4"],
    },
  }, {
    requiredEvidence: ["agentId", "remoteState"],
    assertions: [{ path: "remoteState", oneOf: ["ready"] }],
  });

  assert.ok(needles.includes("remote-agent-create"));
  assert.ok(needles.includes("remoteAgentCreate"));
  assert.ok(needles.includes("/api/agents"));
  assert.ok(needles.includes("agentId"));
  assert.ok(needles.includes("remoteState"));
  assert.ok(needles.includes("SESSION_OPEN_FAILED"));
});

test("discoverInvestigationSources anchors checks, source matches, excerpts, and recent commits", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-source-discovery-"));
  try {
    await mkdir(path.join(tempDir, "infra/evals/status"), { recursive: true });
    await mkdir(path.join(tempDir, "server/routes"), { recursive: true });
    const registryPath = path.join(tempDir, "infra/evals/status/features.json");
    const expectationsPath = path.join(tempDir, "infra/evals/status/check-expectations.json");
    const runnerPath = path.join(tempDir, "infra/evals/status/run-status-probes.mjs");
    const routePath = path.join(tempDir, "server/routes/agents.ts");

    await writeFile(registryPath, JSON.stringify({
      features: [
        {
          id: "remote-agents",
          label: "Remote Agents",
          checks: [{ id: "remote-agent-create", required: true }],
        },
      ],
    }, null, 2));
    await writeFile(expectationsPath, JSON.stringify({
      checks: {
        "remote-agent-create": {
          requiredEvidence: ["orgId", "agentId", "remoteState"],
        },
      },
    }, null, 2));
    await writeFile(runnerPath, [
      "const checks = {",
      "  async \"remote-agent-create\"() {",
      "    return { orgId, agentId, remoteState };",
      "  },",
      "};",
      "",
    ].join("\n"));
    await writeFile(routePath, [
      "export async function createRemoteAgent(request) {",
      "  const response = await fetch('/api/agents', { method: 'POST' });",
      "  if (!response.ok) throw new Error('SESSION_OPEN_FAILED');",
      "  return response.json();",
      "}",
      "",
    ].join("\n"));

    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", [
      "-c",
      "user.name=AURA Test",
      "-c",
      "user.email=aura-test@example.com",
      "commit",
      "-m",
      "seed source discovery fixture",
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-06-14T05:00:00.000Z",
        GIT_COMMITTER_DATE: "2026-06-14T05:00:00.000Z",
      },
    });
    await writeFile(routePath, [
      "export async function createRemoteAgent(request) {",
      "  const response = await fetch('/api/agents', { method: 'POST', timeoutMs: 1000 });",
      "  if (!response.ok) throw new Error('SESSION_OPEN_FAILED');",
      "  return response.json();",
      "}",
      "",
    ].join("\n"));
    await execFileAsync("git", ["add", routePath], { cwd: tempDir });
    await execFileAsync("git", [
      "-c",
      "user.name=AURA Test",
      "-c",
      "user.email=aura-test@example.com",
      "commit",
      "-m",
      "change remote-agent-create route timeout",
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-06-14T07:00:00.000Z",
        GIT_COMMITTER_DATE: "2026-06-14T07:00:00.000Z",
      },
    });

    const discovery = await discoverInvestigationSources({
      check: {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "fail",
        message: "SESSION_OPEN_FAILED: POST /api/agents returned 404",
        endedAt: "2026-06-14T08:10:00.000Z",
        evidence: { orgId: "org_123" },
      },
      feature: { id: "remote-agents", label: "Remote Agents" },
      checkConfig: { id: "remote-agent-create", required: true },
      expectation: { requiredEvidence: ["orgId", "agentId", "remoteState"] },
      previousChecks: [
        {
          checkId: "remote-agent-create",
          status: "pass",
          endedAt: "2026-06-14T06:10:00.000Z",
        },
      ],
      registryPath,
      expectationsPath,
      runnerPath,
      repoRoot: tempDir,
    });

    assert.ok(discovery.sourceHints.some((hint) => hint.kind === "registry-check"));
    assert.ok(discovery.sourceHints.some((hint) => hint.kind === "expected-output-contract"));
    assert.ok(discovery.sourceHints.some((hint) => hint.kind === "eval-runner-branch"));
    assert.ok(discovery.sourceHints.some((hint) => hint.kind === "endpoint-match" && hint.path === "server/routes/agents.ts"));
    assert.ok(discovery.sourceContext.some((context) => context.path === "server/routes/agents.ts" && context.excerpt.includes("/api/agents")));
    assert.equal(discovery.sourceDiscovery.discoveryKind, "aura-observability-source-discovery");
    assert.ok(discovery.sourceDiscovery.rankedPaths.some((entry) => entry.path === "infra/evals/status/run-status-probes.mjs"));
    assert.ok(discovery.sourceDiscovery.candidateCodePaths.some((entry) => entry.path === "server/routes/agents.ts"));
    assert.ok(discovery.sourceDiscovery.recentChanges.some((change) => change.path === "server/routes/agents.ts"));
    assert.ok(discovery.sourceDiscovery.suspectChanges.some((change) => change.subject === "change remote-agent-create route timeout"));
    const suspectChange = discovery.sourceDiscovery.suspectChanges.find((change) => change.subject === "change remote-agent-create route timeout");
    assert.ok(suspectChange.score >= 85);
    assert.ok(suspectChange.reasons.some((reason) => reason.includes("last passing run")));
    assert.deepEqual(suspectChange.candidateTouchedPaths, ["server/routes/agents.ts"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
