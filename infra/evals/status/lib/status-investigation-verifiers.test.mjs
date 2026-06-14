import assert from "node:assert/strict";
import test from "node:test";

import { buildInvestigationVerifierContext } from "./status-investigation-verifiers.mjs";

test("buildInvestigationVerifierContext summarizes contract gaps, sibling failures, history, and source context", () => {
  const verifierContext = buildInvestigationVerifierContext({
    check: {
      checkId: "remote-agent-create",
      featureId: "remote-agents",
      status: "fail",
      message: "POST /api/agents failed with 409: quota exceeded",
      endedAt: "2026-06-14T08:10:45.000Z",
      latencyMs: 1200,
      evidence: {
        orgId: "org_123",
        authorization: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      },
    },
    expectation: {
      requiredEvidence: ["orgId", "agentId", "remoteState"],
      assertions: [{ path: "remoteState", equals: "ready" }],
    },
    siblingChecks: [
      {
        checkId: "remote-agent-state",
        status: "fail",
        message: "POST /api/agents failed with 409: quota exceeded",
      },
      {
        checkId: "local-agent-create",
        status: "pass",
        message: "ok",
      },
    ],
    previousChecks: [
      {
        checkId: "remote-agent-create",
        status: "pass",
        message: "ok",
        endedAt: "2026-06-14T06:10:45.000Z",
        latencyMs: 900,
      },
    ],
    sourceHints: [{ path: "server/routes/agents.ts", line: 14, preview: "POST /api/agents" }],
    sourceContext: [{ path: "server/routes/agents.ts", startLine: 10, endLine: 18, excerpt: "14: POST /api/agents" }],
    sourceDiscovery: {
      rankedPaths: [{ path: "server/routes/agents.ts", score: 80 }],
      candidateCodePaths: [{ path: "server/routes/agents.ts", score: 80 }],
      recentChanges: [
        {
          path: "server/routes/agents.ts",
          commits: ["abc1234 change remote agent route"],
        },
      ],
    },
  });

  assert.equal(verifierContext.verifierKind, "aura-observability-investigation-verifier-context");
  assert.deepEqual(verifierContext.contract.presentRequiredEvidence, ["orgId"]);
  assert.deepEqual(verifierContext.contract.missingRequiredEvidence, ["agentId", "remoteState"]);
  assert.match(verifierContext.contract.contractValidationError, /Missing expected evidence/);
  assert.equal(verifierContext.siblingCorrelation.likelySharedDependencyFailure, true);
  assert.deepEqual(verifierContext.siblingCorrelation.sameMessageSiblingIds, ["remote-agent-state"]);
  assert.equal(verifierContext.history.currentlyRegressedFromPass, true);
  assert.equal(verifierContext.sourceContext.sourcePaths[0], "server/routes/agents.ts");
  assert.equal(verifierContext.sourceContext.rankedPaths[0].path, "server/routes/agents.ts");
  assert.equal(verifierContext.sourceContext.candidateCodePaths[0].path, "server/routes/agents.ts");
  assert.equal(verifierContext.sourceContext.recentChanges[0].path, "server/routes/agents.ts");
  assert.ok(verifierContext.recommendedVerifierProbes.some((probe) => probe.command === "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes"));
  assert.ok(verifierContext.recommendedVerifierProbes.some((probe) => probe.label === "Review recent commits for implicated source paths"));
});
