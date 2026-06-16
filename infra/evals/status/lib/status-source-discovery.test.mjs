import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  discoverInvestigationSources,
  repoSearchNeedlesForCheck,
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

test("repoSearchNeedlesForCheck prioritizes exact runtime evidence over prose terms", () => {
  const needles = repoSearchNeedlesForCheck({
    checkId: "image-generation-stream",
    featureId: "media-generation",
    message: "agent runtime endpoint not found (404): the harness is unreachable or running an incompatible version. Verify the LOCAL_HARNESS_URL / SWARM_BASE_URL configuration.",
    evidence: {
      frameTypes: ["generation_start", "generation_error"],
      frames: [
        {
          event: "generation_error",
          data: {
            code: "SESSION_OPEN_FAILED",
            message: "agent runtime endpoint not found (404)",
          },
        },
      ],
    },
  }, {
    requiredEvidence: ["frameTypes", "imageUrlPresent"],
    assertions: [{ path: "frameTypes", contains: "generation_completed" }],
  });

  assert.ok(needles.indexOf("SESSION_OPEN_FAILED") < 10);
  assert.ok(needles.indexOf("agent runtime endpoint not found (404)") < 10);
  assert.ok(needles.indexOf("LOCAL_HARNESS_URL") < 10);
  assert.ok(needles.indexOf("SWARM_BASE_URL") < 10);
  assert.ok(needles.indexOf("generation_completed") < 18);
  assert.equal(needles.includes("xpected"), false);
});

test("discoverInvestigationSources anchors checks, source matches, excerpts, and recent commits", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-source-discovery-"));
  try {
    await mkdir(path.join(tempDir, "infra/evals/status"), { recursive: true });
    await mkdir(path.join(tempDir, "apps/aura-os-server/src/handlers/agents/chat"), { recursive: true });
    await mkdir(path.join(tempDir, "server/routes"), { recursive: true });
    const registryPath = path.join(tempDir, "infra/evals/status/features.json");
    const expectationsPath = path.join(tempDir, "infra/evals/status/check-expectations.json");
    const runnerPath = path.join(tempDir, "infra/evals/status/run-status-probes.mjs");
    const runtimeErrorPath = path.join(tempDir, "apps/aura-os-server/src/handlers/agents/chat/errors.rs");
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
    await writeFile(runtimeErrorPath, [
      "pub fn map_harness_session_startup_error() -> &'static str {",
      "  \"SESSION_OPEN_FAILED: agent runtime endpoint not found (404): verify LOCAL_HARNESS_URL / SWARM_BASE_URL\"",
      "}",
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
    await writeFile(runtimeErrorPath, [
      "pub fn map_harness_session_startup_error() -> &'static str {",
      "  \"SESSION_OPEN_FAILED: agent runtime endpoint not found (404): the harness is unreachable; verify LOCAL_HARNESS_URL / SWARM_BASE_URL\"",
      "}",
      "",
    ].join("\n"));
    await execFileAsync("git", ["add", routePath], { cwd: tempDir });
    await execFileAsync("git", ["add", runtimeErrorPath], { cwd: tempDir });
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
    assert.ok(discovery.sourceHints.some((hint) => hint.path === "apps/aura-os-server/src/handlers/agents/chat/errors.rs"));
    assert.ok(discovery.sourceContext.some((context) => context.path === "server/routes/agents.ts" && context.excerpt.includes("/api/agents")));
    assert.equal(discovery.sourceDiscovery.discoveryKind, "aura-observability-source-discovery");
    assert.ok(discovery.sourceDiscovery.rankedPaths.some((entry) => entry.path === "infra/evals/status/run-status-probes.mjs"));
    assert.equal(discovery.sourceDiscovery.candidateCodePaths[0].path.startsWith("infra/evals/status/"), false);
    assert.ok(discovery.sourceDiscovery.candidateCodePaths.some((entry) => entry.path === "server/routes/agents.ts"));
    assert.ok(discovery.sourceDiscovery.recentChanges.some((change) => change.path === "server/routes/agents.ts"));
    assert.ok(discovery.sourceDiscovery.suspectChanges.some((change) => change.subject === "change remote-agent-create route timeout"));
    const suspectChange = discovery.sourceDiscovery.suspectChanges.find((change) => change.subject === "change remote-agent-create route timeout");
    assert.ok(suspectChange.score >= 85);
    assert.ok(suspectChange.reasons.some((reason) => reason.includes("last passing run")));
    assert.deepEqual(suspectChange.candidateTouchedPaths, [
      "apps/aura-os-server/src/handlers/agents/chat/errors.rs",
      "server/routes/agents.ts",
    ]);
    assert.equal(
      discovery.sourceDiscovery.suspectChanges.some((change) =>
        change.candidateTouchedPaths?.some((candidatePath) => candidatePath.startsWith("infra/evals/status/")),
      ),
      false,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
