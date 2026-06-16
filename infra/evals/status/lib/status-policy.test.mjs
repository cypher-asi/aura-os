import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_STATUS,
  FEATURE_STATUS,
  aggregateFeature,
  buildStatusSnapshot,
} from "./status-policy.mjs";

const GENERATED_AT = "2026-06-10T12:00:00.000Z";

test("aggregateFeature marks a fully passing feature operational", () => {
  const feature = {
    id: "core-api",
    label: "Core API",
    category: "platform",
    outageAfterFailures: 2,
    checks: [
      { id: "api-health", required: true, staleAfterMinutes: 10 },
      { id: "auth-session", required: true, staleAfterMinutes: 10 },
    ],
    outageAfterFailures: 2,
  };
  const checks = new Map([
    [
      "api-health",
      {
        checkId: "api-health",
        status: CHECK_STATUS.PASS,
        endedAt: GENERATED_AT,
        latencyMs: 100,
        evidence: {},
      },
    ],
    [
      "auth-session",
      {
        checkId: "auth-session",
        status: CHECK_STATUS.PASS,
        endedAt: GENERATED_AT,
        latencyMs: 120,
        evidence: {},
      },
    ],
  ]);

  const result = aggregateFeature(feature, checks, GENERATED_AT);

  assert.equal(result.status, FEATURE_STATUS.OPERATIONAL);
  assert.equal(result.checksPassed, 2);
});

test("aggregateFeature escalates repeated required failures to major outage", () => {
  const feature = {
    id: "remote-agents",
    label: "Remote Agents",
    category: "agents",
    checks: [
      { id: "remote-agent-create", required: true, staleAfterMinutes: 10 },
      { id: "remote-agent-state", required: true, staleAfterMinutes: 10 },
      { id: "remote-agent-runtime", required: false, staleAfterMinutes: 10 },
    ],
    outageAfterFailures: 2,
  };
  const checks = new Map([
    [
      "remote-agent-create",
      {
        checkId: "remote-agent-create",
        status: CHECK_STATUS.FAIL,
        message: "provisioning failed",
        endedAt: GENERATED_AT,
        latencyMs: 1000,
        evidence: {},
      },
    ],
    [
      "remote-agent-state",
      {
        checkId: "remote-agent-state",
        status: CHECK_STATUS.FAIL,
        message: "state polling failed",
        endedAt: GENERATED_AT,
        latencyMs: 1000,
        evidence: {},
      },
    ],
  ]);

  const result = aggregateFeature(feature, checks, GENERATED_AT);

  assert.equal(result.status, FEATURE_STATUS.MAJOR_OUTAGE);
  assert.equal(result.checksFailed, 2);
});

test("buildStatusSnapshot picks the latest check result and computes overall severity", () => {
  const registry = {
    title: "AURA Observability",
    features: [
      {
        id: "models",
        label: "Models",
        category: "models",
        priority: 10,
        checks: [{ id: "model-matrix", required: true, staleAfterMinutes: 10 }],
        outageAfterFailures: 1,
      },
      {
        id: "media",
        label: "Image Generation",
        category: "media",
        priority: 20,
        checks: [{ id: "image-generation-stream", required: true, staleAfterMinutes: 10 }],
      },
    ],
  };
  const snapshot = buildStatusSnapshot({
    registry,
    generatedAt: GENERATED_AT,
    environment: "test",
    checks: [
      {
        checkId: "model-matrix",
        featureId: "models",
        status: CHECK_STATUS.FAIL,
        endedAt: "2026-06-10T11:55:00.000Z",
      },
      {
        checkId: "model-matrix",
        featureId: "models",
        status: CHECK_STATUS.PASS,
        endedAt: "2026-06-10T11:59:00.000Z",
      },
      {
        checkId: "image-generation-stream",
        featureId: "media",
        status: CHECK_STATUS.WARN,
        message: "slow stream",
        endedAt: GENERATED_AT,
      },
    ],
  });

  assert.equal(snapshot.features[0].status, FEATURE_STATUS.OPERATIONAL);
  assert.equal(snapshot.features[1].status, FEATURE_STATUS.DEGRADED);
  assert.equal(snapshot.overall, FEATURE_STATUS.DEGRADED);
  assert.equal(snapshot.totals.degraded, 1);
});

test("buildStatusSnapshot separates feature health from runtime-specific media checks", () => {
  const registry = {
    title: "AURA Observability",
    runtimeEnvironments: [
      { id: "desktop-release", label: "Desktop Release" },
      { id: "production-api", label: "Production API" },
    ],
    features: [
      {
        id: "media-generation",
        label: "Media Generation",
        category: "media",
        priority: 10,
        checks: [
          {
            id: "image-generation-stream",
            label: "Image generation stream",
            runtimeEnvironment: "desktop-release",
            required: true,
            staleAfterMinutes: 10,
          },
          {
            id: "image-generation-stream",
            label: "Image generation stream",
            runtimeEnvironment: "production-api",
            required: false,
            statusImpact: "informational",
            staleAfterMinutes: 10,
          },
        ],
        outageAfterFailures: 1,
      },
    ],
  };

  const waitingForDesktop = buildStatusSnapshot({
    registry,
    generatedAt: GENERATED_AT,
    environment: "production",
    checks: [
      {
        checkId: "image-generation-stream",
        featureId: "media-generation",
        status: CHECK_STATUS.FAIL,
        message: "production API has no harness route",
        endedAt: GENERATED_AT,
        runtimeEnvironment: "production-api",
      },
    ],
  });

  assert.equal(waitingForDesktop.features[0].status, FEATURE_STATUS.UNKNOWN);
  assert.equal(waitingForDesktop.features[0].message, "No recent result");
  assert.equal(waitingForDesktop.features[0].checks[1].statusImpact, "informational");
  assert.equal(waitingForDesktop.features[0].checks[1].runtimeLabel, "Production API");

  const desktopPassing = buildStatusSnapshot({
    registry,
    generatedAt: GENERATED_AT,
    environment: "desktop-nightly-macos-aarch64",
    checks: [
      {
        checkId: "image-generation-stream",
        featureId: "media-generation",
        status: CHECK_STATUS.PASS,
        endedAt: GENERATED_AT,
        runtimeEnvironment: "desktop-release",
        evidence: { frameTypes: ["generation_start", "generation_completed"], imageUrlPresent: true },
      },
      {
        checkId: "image-generation-stream",
        featureId: "media-generation",
        status: CHECK_STATUS.FAIL,
        message: "production API has no harness route",
        endedAt: GENERATED_AT,
        runtimeEnvironment: "production-api",
      },
    ],
  });

  assert.equal(desktopPassing.features[0].status, FEATURE_STATUS.OPERATIONAL);
  assert.equal(desktopPassing.features[0].checksPassed, 1);
  assert.equal(desktopPassing.features[0].checksFailed, 1);
  assert.equal(desktopPassing.totals.runtimeEnvironments, 2);
  assert.deepEqual(
    desktopPassing.runtimeEnvironments.map((runtime) => runtime.label),
    ["Desktop Release", "Production API"],
  );
});

test("buildStatusSnapshot attaches LLM-generated investigations to failed checks", () => {
  const registry = {
    title: "AURA Observability",
    features: [
      {
        id: "media-generation",
        label: "Image Generation",
        category: "media",
        priority: 20,
        checks: [{ id: "image-generation-stream", required: true, staleAfterMinutes: 10 }],
      },
    ],
  };

  const snapshot = buildStatusSnapshot({
    registry,
    generatedAt: GENERATED_AT,
    environment: "production",
    source: "github-actions",
    checks: [
      {
        checkId: "image-generation-stream",
        featureId: "media-generation",
        status: CHECK_STATUS.FAIL,
        message: "session_open_failed: POST /v1/run returned 404 from configured local harness URL",
        endedAt: GENERATED_AT,
        latencyMs: 1800,
        evidence: {
          frames: [
            {
              event: "generation_error",
              data: { code: "session_open_failed", status: 404 },
            },
          ],
        },
      },
    ],
    investigations: [
      {
        schemaVersion: 1,
        kind: "llm-investigation",
        id: "media-generation:image-generation-stream:investigator",
        featureId: "media-generation",
        featureLabel: "Media Generation",
        checkId: "image-generation-stream",
        title: "Image stream failure depends on harness runtime",
        status: "ready",
        checkStatus: "fail",
        generatedAt: GENERATED_AT,
        confidence: "medium",
        summary: "The image stream produced a session_open_failed event before completion.",
        rootCause: "The supplied evidence points at the harness runtime open path returning 404 before image generation can finish.",
        proof: ["generation_error has code session_open_failed and status 404"],
        possibleCauses: ["The harness runtime URL or /v1/run route is unavailable"],
        reproductionSteps: [
          {
            label: "Run image Evolve",
            command: "AURA_STATUS_CHECKS=image-generation-stream npm run status:probes",
          },
        ],
        affectedAreas: [
          {
            label: "Image stream probe",
            path: "infra/evals/status/run-status-probes.mjs",
            reason: "The check captured the failing SSE frame.",
          },
        ],
        whatWouldDisproveThis: ["The same check emits generation_completed and imageUrlPresent."],
        recommendedVerifierProbes: [
          {
            label: "Run harness-health",
            command: "AURA_STATUS_CHECKS=harness-health npm run status:probes",
          },
        ],
        recommendedNextActions: ["Run harness-health before debugging image generation."],
        followUpEvals: ["harness-health"],
      },
    ],
  });

  assert.equal(snapshot.totals.investigations, 1);
  assert.equal(snapshot.investigations.length, 1);
  const investigation = snapshot.investigations[0];
  assert.equal(investigation.id, "media-generation:image-generation-stream:investigator");
  assert.equal(investigation.title, "Image stream failure depends on harness runtime");
  assert.equal(investigation.environment, "production");
  assert.equal(investigation.source, "github-actions");
  assert.equal(investigation.featureStatus, FEATURE_STATUS.PARTIAL_OUTAGE);
  assert.deepEqual(investigation.proof, ["generation_error has code session_open_failed and status 404"]);
  assert.equal(investigation.whatWouldDisproveThis[0], "The same check emits generation_completed and imageUrlPresent.");
  assert.equal(investigation.recommendedVerifierProbes[0].label, "Run harness-health");
  assert.equal(snapshot.features[0].checks[0].investigation.id, investigation.id);
});

test("buildStatusSnapshot reports a failed check without inventing a diagnosis", () => {
  const registry = {
    title: "AURA Observability",
    features: [
      {
        id: "model-responses",
        label: "Model Responses",
        category: "models",
        priority: 19,
        checks: [{ id: "model-matrix", required: true, staleAfterMinutes: 10 }],
        outageAfterFailures: 1,
      },
    ],
  };

  const snapshot = buildStatusSnapshot({
    registry,
    generatedAt: GENERATED_AT,
    environment: "production",
    source: "github-actions",
    checks: [
      {
        checkId: "model-matrix",
        featureId: "model-responses",
        status: CHECK_STATUS.FAIL,
        message: "1/2 models returned the expected response",
        endedAt: GENERATED_AT,
        latencyMs: 900,
        evidence: {
          expectedPhrase: "hello from aura",
          passed: 1,
          total: 2,
          failedModels: ["aura-small"],
        },
      },
    ],
  });

  assert.equal(snapshot.overall, FEATURE_STATUS.MAJOR_OUTAGE);
  assert.equal(snapshot.features[0].label, "Model Responses");
  assert.equal(snapshot.totals.investigations, 0);
  assert.deepEqual(snapshot.investigations, []);
  assert.equal(snapshot.features[0].checks[0].investigation, undefined);
});

test("aggregateFeature degrades and outages on slow passing checks", () => {
  const feature = {
    id: "core-api",
    label: "Core API",
    category: "platform",
    outageAfterFailures: 2,
    checks: [
      {
        id: "api-health",
        required: true,
        staleAfterMinutes: 10,
        warningLatencyMs: 1000,
        outageLatencyMs: 5000,
      },
    ],
  };

  const degraded = aggregateFeature(
    feature,
    new Map([
      [
        "api-health",
        {
          checkId: "api-health",
          status: CHECK_STATUS.PASS,
          endedAt: GENERATED_AT,
          latencyMs: 1200,
          evidence: {},
        },
      ],
    ]),
    GENERATED_AT,
  );
  assert.equal(degraded.status, FEATURE_STATUS.DEGRADED);
  assert.match(degraded.message, /Latency 1200ms exceeded warning threshold/);

  const outage = aggregateFeature(
    feature,
    new Map([
      [
        "api-health",
        {
          checkId: "api-health",
          status: CHECK_STATUS.PASS,
          endedAt: GENERATED_AT,
          latencyMs: 5000,
          evidence: {},
        },
      ],
    ]),
    GENERATED_AT,
  );
  assert.equal(outage.status, FEATURE_STATUS.PARTIAL_OUTAGE);
  assert.match(outage.message, /Latency 5000ms exceeded outage threshold/);
});

test("aggregateFeature reports the active severity reason before missing optional checks", () => {
  const feature = {
    id: "public-experience",
    label: "Public Chat and APIs",
    category: "website",
    checks: [
      { id: "public-setup", required: true, staleAfterMinutes: 10 },
      { id: "public-blog-api", required: false, staleAfterMinutes: 10 },
    ],
    degradedAfterFailures: 1,
    outageAfterFailures: 2,
  };
  const result = aggregateFeature(
    feature,
    new Map([
      [
        "public-blog-api",
        {
          checkId: "public-blog-api",
          status: CHECK_STATUS.FAIL,
          message: "count expected >= 1 but got 0",
          endedAt: GENERATED_AT,
          latencyMs: 100,
          evidence: {},
        },
      ],
    ]),
    GENERATED_AT,
  );

  assert.equal(result.status, FEATURE_STATUS.DEGRADED);
  assert.equal(result.message, "count expected >= 1 but got 0");
});

test("aggregateFeature keeps public routes operational when snapshot freshness metadata fails", () => {
  const feature = {
    id: "public-website",
    label: "Public Website",
    category: "website",
    checks: [
      {
        id: "published-observability-snapshot",
        required: false,
        statusImpact: "informational",
        staleAfterMinutes: 360,
      },
      { id: "public-observability-page", required: true, staleAfterMinutes: 15 },
      { id: "public-marketing-pages", required: false, staleAfterMinutes: 30 },
    ],
    degradedAfterFailures: 1,
  };

  const result = aggregateFeature(
    feature,
    new Map([
      [
        "published-observability-snapshot",
        {
          checkId: "published-observability-snapshot",
          status: CHECK_STATUS.FAIL,
          message: "snapshotAgeMinutes expected <= 300 but got 360",
          endedAt: GENERATED_AT,
          latencyMs: 100,
          evidence: { snapshotAgeMinutes: 360 },
        },
      ],
      [
        "public-observability-page",
        {
          checkId: "public-observability-page",
          status: CHECK_STATUS.PASS,
          endedAt: GENERATED_AT,
          latencyMs: 200,
          evidence: { status: 200 },
        },
      ],
      [
        "public-marketing-pages",
        {
          checkId: "public-marketing-pages",
          status: CHECK_STATUS.PASS,
          endedAt: GENERATED_AT,
          latencyMs: 300,
          evidence: { allRoutesOk: true },
        },
      ],
    ]),
    GENERATED_AT,
  );

  assert.equal(result.status, FEATURE_STATUS.OPERATIONAL);
  assert.equal(result.checksFailed, 1);
  assert.equal(result.message, "All required checks are passing.");
  assert.equal(result.checks[0].statusImpact, "informational");
  assert.equal(result.checks[0].featureStatus, FEATURE_STATUS.OPERATIONAL);
});

test("aggregateFeature uses run completion time for staleness", () => {
  const feature = {
    id: "core-api",
    label: "Core API",
    category: "platform",
    checks: [
      { id: "api-health", required: true, staleAfterMinutes: 5 },
    ],
  };
  const result = aggregateFeature(
    feature,
    new Map([
      [
        "api-health",
        {
          checkId: "api-health",
          status: CHECK_STATUS.PASS,
          endedAt: "2026-06-10T11:50:00.000Z",
          runGeneratedAt: "2026-06-10T11:59:00.000Z",
          latencyMs: 100,
          evidence: {},
        },
      ],
    ]),
    GENERATED_AT,
  );

  assert.equal(result.status, FEATURE_STATUS.OPERATIONAL);
  assert.equal(result.message, "All required checks are passing.");
});
