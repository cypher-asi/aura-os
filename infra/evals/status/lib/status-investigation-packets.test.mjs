import assert from "node:assert/strict";
import test from "node:test";

import { buildInvestigationEvidencePacket } from "./status-investigation-packets.mjs";

test("buildInvestigationEvidencePacket captures contracts, sibling patterns, and redacts secrets", () => {
  const packet = buildInvestigationEvidencePacket({
    check: {
      checkId: "image-generation-stream",
      featureId: "media-generation",
      label: "Image generation stream",
      status: "fail",
      message: "SESSION_OPEN_FAILED: POST /v1/run returned 404",
      startedAt: "2026-06-14T08:10:00.000Z",
      endedAt: "2026-06-14T08:10:02.000Z",
      runGeneratedAt: "2026-06-14T08:10:03.000Z",
      latencyMs: 2000,
      environment: "production",
      evidence: {
        frameTypes: ["generation_start", "generation_error"],
        authorization: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      },
    },
    feature: {
      id: "media-generation",
      label: "Media Generation",
      category: "media",
      description: "Image generation stream routing.",
    },
    checkConfig: {
      id: "image-generation-stream",
      required: true,
      warningLatencyMs: 20000,
    },
    expectation: {
      description: "Image generation emits stream frames and a final artifact URL.",
      requiredEvidence: ["frameTypes", "imageUrlPresent"],
    },
    siblingChecks: [
      {
        checkId: "harness-health",
        featureId: "local-agents",
        status: "pass",
        message: "Harness is reachable",
        endedAt: "2026-06-14T08:10:01.000Z",
        latencyMs: 50,
        evidence: { reachable: true },
      },
    ],
    sourceHints: [
      {
        needle: "image-generation-stream",
        path: "infra/evals/status/run-status-probes.mjs",
        line: 900,
        preview: "image-generation-stream",
      },
    ],
  });

  assert.equal(packet.packetKind, "aura-observability-investigation-packet");
  assert.equal(packet.feature.id, "media-generation");
  assert.deepEqual(packet.checkContract.presentRequiredEvidence, ["frameTypes"]);
  assert.deepEqual(packet.checkContract.missingRequiredEvidence, ["imageUrlPresent"]);
  assert.equal(packet.failedCheck.evidence.authorization, "[REDACTED]");
  assert.equal(packet.siblingPattern.passed[0], "harness-health");
  assert.equal(packet.reproductionHint.command, "AURA_STATUS_CHECKS=image-generation-stream npm run status:probes");
  assert.ok(packet.evidenceItems.some((item) => item.id === "expected-output.missing-required-evidence"));
  assert.ok(packet.evidenceItems.some((item) => item.id === "source.infra/evals/status/run-status-probes.mjs:900"));
});
