import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvestigationInput,
  INVESTIGATOR_SYSTEM_PROMPT,
  investigateCheck,
  missingRequiredInvestigationFields,
  needsInvestigation,
} from "./status-investigator.mjs";

const CHECK = {
  checkId: "image-generation-stream",
  featureId: "media-generation",
  label: "Image generation stream",
  status: "fail",
  message: "Image generation error: session_open_failed: POST /v1/run returned 404",
  startedAt: "2026-06-10T11:59:00.000Z",
  endedAt: "2026-06-10T12:00:00.000Z",
  latencyMs: 900,
  environment: "production",
  evidence: {
    code: "session_open_failed",
    httpStatus: 404,
    localHarnessUrl: "http://127.0.0.1:8080",
    authorization: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
  },
};

const FEATURE = {
  id: "media-generation",
  label: "Media Generation",
  category: "media",
  description: "Image generation stream routing, progress frames, completion payloads, and artifact URLs.",
  publicSummary: "AURA image generation streams can complete with generated artifacts.",
};

test("needsInvestigation only selects failing and warning checks", () => {
  assert.equal(needsInvestigation({ status: "fail" }), true);
  assert.equal(needsInvestigation({ status: "warn" }), true);
  assert.equal(needsInvestigation({ status: "pass" }), false);
  assert.equal(needsInvestigation({ status: "skip" }), false);
});

test("buildInvestigationInput includes factual contracts and redacts secrets", () => {
  const input = buildInvestigationInput({
    check: CHECK,
    feature: FEATURE,
    checkConfig: { id: "image-generation-stream", required: true },
    expectation: {
      description: "Image generation stream emits frame types and a completion artifact signal.",
      requiredEvidence: ["frameTypes", "imageUrlPresent"],
    },
    sourceHints: [{ path: "infra/evals/status/run-status-probes.mjs", line: 930, preview: "image-generation-stream" }],
  });

  assert.equal(input.feature.id, "media-generation");
  assert.equal(input.failedCheck.checkId, "image-generation-stream");
  assert.equal(input.expectedOutputContract.requiredEvidence[0], "frameTypes");
  assert.equal(input.investigationPacket.packetKind, "aura-observability-investigation-packet");
  assert.deepEqual(input.investigationPacket.checkContract.missingRequiredEvidence, ["frameTypes", "imageUrlPresent"]);
  assert.equal(input.failedCheck.evidence.authorization, "[REDACTED]");
  assert.equal(input.sourceHints[0].path, "infra/evals/status/run-status-probes.mjs");
});

test("investigator prompt keeps impact scoped to supplied eval evidence", () => {
  assert.match(INVESTIGATOR_SYSTEM_PROMPT, /Distinguish an eval failure from a user-facing product outage/);
  assert.match(INVESTIGATOR_SYSTEM_PROMPT, /structured investigation packet/);
  assert.match(INVESTIGATOR_SYSTEM_PROMPT, /evidenceItems ids/);
  assert.match(INVESTIGATOR_SYSTEM_PROMPT, /Do not claim production users or real traffic are impacted/);
  assert.match(INVESTIGATOR_SYSTEM_PROMPT, /If a broad health check passed but a specific endpoint or route failed/);
});

test("investigateCheck normalizes model-authored JSON without a deterministic diagnosis", async () => {
  const investigation = await investigateCheck({
    check: CHECK,
    feature: FEATURE,
    checkConfig: { id: "image-generation-stream", required: true },
    expectation: null,
    generatedAt: "2026-06-10T12:00:00.000Z",
    environment: "production",
    source: "unit-test",
    provider: "mock",
    model: "mock-investigator",
    callModel: async () => JSON.stringify({
      title: "Image generation stream cannot open a runtime session",
      confidence: "high",
      summary: "The image stream failed before producing a completion artifact.",
      rootCause: "The evidence shows POST /v1/run returned 404 before image generation could complete.",
      proof: ["httpStatus is 404", "code is session_open_failed"],
      possibleCauses: ["The local harness route is unavailable"],
      reproductionSteps: [
        {
          label: "Run image generation stream",
          command: "AURA_STATUS_CHECKS=image-generation-stream npm run status:probes",
        },
      ],
      affectedAreas: [
        {
          label: "Image stream probe",
          path: "infra/evals/status/run-status-probes.mjs",
          reason: "The probe captured the 404.",
        },
      ],
      recommendedNextActions: ["Check the packaged harness route table."],
      followUpEvals: ["harness-health"],
    }),
  });

  assert.equal(investigation.status, "ready");
  assert.equal(investigation.title, "Image generation stream cannot open a runtime session");
  assert.equal(investigation.rootCause, "The evidence shows POST /v1/run returned 404 before image generation could complete.");
  assert.equal(investigation.provider, "mock");
  assert.equal(investigation.model, "mock-investigator");
  assert.equal(investigation.evidenceDigest.evidence.authorization, "[REDACTED]");
});

test("investigateCheck retries incomplete model reports instead of filling fields locally", async () => {
  let calls = 0;
  const investigation = await investigateCheck({
    check: CHECK,
    feature: FEATURE,
    checkConfig: { id: "image-generation-stream", required: true },
    expectation: null,
    generatedAt: "2026-06-10T12:00:00.000Z",
    environment: "production",
    source: "unit-test",
    provider: "mock",
    model: "mock-investigator",
    callModel: async () => {
      calls += 1;
      return JSON.stringify({
        title: "Image generation stream cannot open a runtime session",
        confidence: "high",
        summary: "The image stream failed before producing a completion artifact.",
        rootCause: "The evidence shows POST /v1/run returned 404 before image generation could complete.",
        proof: ["httpStatus is 404"],
        possibleCauses: ["The local harness route is unavailable"],
        reproductionSteps: [{ label: "Run image generation stream" }],
        affectedAreas: calls === 1 ? [] : [{ label: "Image stream probe", path: "infra/evals/status/run-status-probes.mjs" }],
        recommendedNextActions: calls === 1 ? [] : ["Check the runtime route before changing media generation."],
        followUpEvals: [],
      });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(missingRequiredInvestigationFields(investigation), []);
  assert.equal(investigation.affectedAreas[0].label, "Image stream probe");
  assert.equal(investigation.recommendedNextActions[0], "Check the runtime route before changing media generation.");
});
