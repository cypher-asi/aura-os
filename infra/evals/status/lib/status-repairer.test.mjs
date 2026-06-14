import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRepairInput,
  missingRequiredRepairFields,
  meetsRepairConfidence,
  normalizeRepairResponse,
  pathsFromUnifiedDiff,
  REPAIR_SYSTEM_PROMPT,
  validateUnifiedDiff,
} from "./status-repairer.mjs";

const validDiff = [
  "diff --git a/server/routes/agents.ts b/server/routes/agents.ts",
  "index 1111111..2222222 100644",
  "--- a/server/routes/agents.ts",
  "+++ b/server/routes/agents.ts",
  "@@ -1,3 +1,3 @@",
  "-const timeoutMs = 1000;",
  "+const timeoutMs = 5000;",
  "",
].join("\n");

test("buildRepairInput preserves investigation proof and source-discovery candidates", () => {
  const input = buildRepairInput({
    check: {
      checkId: "remote-agent-create",
      featureId: "remote-agents",
      status: "fail",
      message: "POST /api/agents failed with 409",
      evidence: {
        orgId: "org_123",
        authorization: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      },
    },
    feature: { id: "remote-agents", label: "Remote Agents" },
    checkConfig: { id: "remote-agent-create", required: true },
    expectation: { requiredEvidence: ["orgId", "agentId", "remoteState"] },
    investigation: {
      id: "remote-agents:remote-agent-create:abc123",
      title: "Remote agent creation blocked",
      confidence: "high",
      summary: "Agent creation did not return an agent id.",
      rootCause: "POST /api/agents failed before an agent record existed.",
      proof: ["expected-output.missing-required-evidence lists agentId."],
      reproductionSteps: [{ label: "Run probe", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
      affectedAreas: [{ label: "Agent route", path: "server/routes/agents.ts" }],
    },
    sourceDiscovery: {
      candidateCodePaths: [{ path: "server/routes/agents.ts", score: 120 }],
      recentChanges: [{ path: "server/routes/agents.ts", commits: ["abc123 change route"] }],
      suspectChanges: [
        {
          commit: "abc123def456",
          shortCommit: "abc123",
          subject: "change remote-agent-create route timeout",
          score: 90,
          reasons: ["Changed after the last passing run and before this failing run."],
        },
      ],
    },
  });

  assert.match(REPAIR_SYSTEM_PROMPT, /gated observability repair planner/);
  assert.match(REPAIR_SYSTEM_PROMPT, /suspect commits or PRs as localization hints/);
  assert.equal(input.repairGoal, "Propose the smallest gated code repair for this AURA observability eval failure.");
  assert.equal(input.failedCheck.evidence.authorization, "[REDACTED]");
  assert.equal(input.investigation.proof[0], "expected-output.missing-required-evidence lists agentId.");
  assert.equal(input.sourceDiscovery.candidateCodePaths[0].path, "server/routes/agents.ts");
  assert.equal(input.sourceDiscovery.suspectChanges[0].shortCommit, "abc123");
  assert.ok(input.defaultVerificationCommands.includes("AURA_STATUS_CHECKS=remote-agent-create npm run status:probes"));
});

test("normalizeRepairResponse requires real patch fields only for repairable proposals", () => {
  const repair = normalizeRepairResponse({
    repairable: true,
    title: "Increase remote agent create timeout",
    confidence: "medium",
    summary: "Extends timeout for the remote agent creation route.",
    rootCause: "The route timed out before VM readiness.",
    proof: ["source-discovery.ranked-paths points at server/routes/agents.ts."],
    changePlan: ["Increase timeout."],
    targetFiles: ["server/routes/agents.ts"],
    unifiedDiff: validDiff,
    verificationCommands: ["AURA_STATUS_CHECKS=remote-agent-create npm run status:probes"],
    risks: ["Remote agent provisioning can still fail upstream."],
    requiresHumanReview: true,
    followUpEvals: ["remote-agent-create-timeout"],
  }, {
    check: { checkId: "remote-agent-create", featureId: "remote-agents" },
    feature: { id: "remote-agents", label: "Remote Agents" },
    investigation: { id: "inv_123" },
    generatedAt: "2026-06-14T08:10:00.000Z",
    environment: "test",
    source: "unit-test",
    provider: "openai-compatible",
    model: "mock",
  });

  assert.equal(repair.repairable, true);
  assert.equal(repair.status, "ready");
  assert.deepEqual(missingRequiredRepairFields(repair), []);
  assert.equal(meetsRepairConfidence(repair, "medium"), true);
  assert.equal(meetsRepairConfidence(repair, "high"), false);
  assert.equal(repair.targetFiles[0], "server/routes/agents.ts");

  const notRepairable = normalizeRepairResponse({
    repairable: false,
    title: "No supported repair",
    confidence: "low",
    summary: "The failure lacks enough proof for a patch.",
    rootCause: "Unknown upstream behavior.",
    proof: ["The investigation is inconclusive."],
    changePlan: ["Collect more evidence."],
    targetFiles: [],
    unifiedDiff: "",
    verificationCommands: [],
    risks: ["A patch would be speculative."],
    requiresHumanReview: true,
    followUpEvals: [],
  }, {
    check: { checkId: "remote-agent-create", featureId: "remote-agents" },
    feature: { id: "remote-agents", label: "Remote Agents" },
    investigation: { id: "inv_123" },
    generatedAt: "2026-06-14T08:10:00.000Z",
  });

  assert.equal(notRepairable.repairable, false);
  assert.deepEqual(missingRequiredRepairFields(notRepairable), []);
});

test("validateUnifiedDiff rejects unsafe repair patch paths", () => {
  assert.deepEqual(pathsFromUnifiedDiff(validDiff), ["server/routes/agents.ts"]);
  assert.deepEqual(validateUnifiedDiff(validDiff, { repoRoot: "/tmp/aura-os" }), []);

  const reportDiff = validDiff.replaceAll("server/routes/agents.ts", "infra/evals/reports/status/status.json");
  assert.match(validateUnifiedDiff(reportDiff, { repoRoot: "/tmp/aura-os" }).join("\n"), /Forbidden patch path/);

  const escapeDiff = [
    "diff --git a/../secret.txt b/../secret.txt",
    "--- a/../secret.txt",
    "+++ b/../secret.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  assert.match(validateUnifiedDiff(escapeDiff, { repoRoot: "/tmp/aura-os" }).join("\n"), /Unsafe patch path/);
});
