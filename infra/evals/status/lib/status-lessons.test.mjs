import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningInput,
  LEARNING_SYSTEM_PROMPT,
  normalizeLearningResponse,
} from "./status-lessons.mjs";

test("buildLearningInput preserves durable evidence and redacts secrets", () => {
  const input = buildLearningInput({
    checks: [
      {
        checkId: "image-generation-stream",
        featureId: "media-generation",
        status: "fail",
      },
    ],
    investigations: [{ id: "media-generation:image-generation-stream:inv" }],
    repairs: [{ id: "media-generation:image-generation-stream:repair", status: "ready" }],
    repairDispatchPlan: { shouldDispatch: true, checks: ["image-generation-stream"] },
    learningCases: [
      {
        check: {
          checkId: "image-generation-stream",
          featureId: "media-generation",
          status: "fail",
          message: "Stream did not produce final image URL",
          evidence: {
            frameTypes: ["generation_start", "generation_error"],
            authorization: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
          },
        },
        feature: { id: "media-generation", label: "Media Generation" },
        checkConfig: { id: "image-generation-stream", required: true },
        expectation: {
          requiredEvidence: ["frameTypes", "imageUrlPresent"],
        },
        investigation: {
          id: "media-generation:image-generation-stream:inv",
          proof: ["expected-output.missing-required-evidence lists imageUrlPresent."],
        },
        repair: {
          id: "media-generation:image-generation-stream:repair",
          status: "ready",
          unifiedDiff: "diff --git a/secret b/secret",
          verificationCommands: ["AURA_STATUS_CHECKS=image-generation-stream npm run status:probes"],
        },
        sourceDiscovery: {
          candidateCodePaths: [{ path: "infra/evals/status/run-status-probes.mjs", score: 100 }],
          suspectChanges: [{ shortCommit: "abc1234", reasons: ["Touches candidate source path(s)."] }],
        },
      },
    ],
    generatedAt: "2026-06-14T08:10:00.000Z",
    environment: "test",
    source: "unit-test",
  });

  assert.match(LEARNING_SYSTEM_PROMPT, /observability learning analyst/);
  assert.equal(input.learningGoal, "Extract durable AURA observability lessons from eval failures, investigations, repairs, and verification outcomes.");
  assert.deepEqual(input.runSummary.failingCheckIds, ["image-generation-stream"]);
  assert.equal(input.cases[0].check.evidence.authorization, "[REDACTED]");
  assert.deepEqual(input.cases[0].expectedOutputContract.missingRequiredEvidence, ["imageUrlPresent"]);
  assert.equal(input.cases[0].sourceDiscovery.suspectChanges[0].shortCommit, "abc1234");
  assert.equal(input.cases[0].repair.unifiedDiff, undefined);
});

test("normalizeLearningResponse keeps only evidence-backed reusable lessons", () => {
  const payload = normalizeLearningResponse({
    lessons: [
      {
        title: "Require terminal media artifact evidence",
        category: "eval-coverage",
        confidence: "high",
        summary: "Media-generation evals should require both stream frames and a terminal artifact URL.",
        evidence: ["image-generation-stream", "expected-output.missing-required-evidence"],
        appliesTo: ["media-generation", "image-generation-stream"],
        recommendedActions: ["Keep imageUrlPresent as required evidence."],
        followUpEvals: ["image-generation-terminal-artifact"],
        sourceDiscoveryHints: ["Search stream frame handlers for imageUrlPresent writes."],
        repairPlaybookNotes: ["Do not repair by weakening the expected-output contract."],
        promptGuardrails: ["Treat missing terminal artifact evidence as earlier than downstream dashboard status."],
      },
      {
        title: "Missing evidence should be dropped",
        category: "eval-coverage",
        confidence: "high",
        summary: "This lesson has no citations.",
        evidence: [],
      },
    ],
  }, {
    generatedAt: "2026-06-14T08:10:00.000Z",
    environment: "test",
    source: "unit-test",
    provider: "openai-compatible",
    model: "mock",
  });

  assert.equal(payload.status, "ready");
  assert.equal(payload.lessons.length, 1);
  assert.equal(payload.lessons[0].category, "eval-coverage");
  assert.equal(payload.lessons[0].confidence, "high");
  assert.equal(payload.lessons[0].followUpEvals[0], "image-generation-terminal-artifact");
});
