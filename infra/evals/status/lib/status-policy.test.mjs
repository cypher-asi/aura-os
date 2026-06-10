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
    title: "Aura Feature Health",
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
      { id: "public-models-api", required: false, staleAfterMinutes: 10 },
    ],
    degradedAfterFailures: 1,
    outageAfterFailures: 2,
  };
  const result = aggregateFeature(
    feature,
    new Map([
      [
        "public-models-api",
        {
          checkId: "public-models-api",
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
