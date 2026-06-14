import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import {
  buildObservabilityIngestPayload,
  persistObservabilityRun,
} from "./status-persistence.mjs";

function sampleSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-12T22:41:55.355Z",
    source: "github-actions",
    environment: "production",
    overall: "major_outage",
    totals: { features: 1, operational: 0, majorOutage: 1 },
    features: [{
      id: "remote-agents",
      label: "Remote Agents",
      category: "agents",
      priority: 30,
      status: "major_outage",
      checks: [{
        id: "remote-agent-create",
        required: true,
        status: "fail",
        featureStatus: "major_outage",
        checkedAt: "2026-06-12T22:40:12.000Z",
        latencyMs: 135766,
        evidence: { remoteState: "unschedulable" },
      }],
    }],
    ...overrides,
  };
}

test("buildObservabilityIngestPayload derives storage ingest metadata from snapshot and CI context", () => {
  const snapshot = sampleSnapshot();
  const payload = buildObservabilityIngestPayload(snapshot, {
    source: "desktop-nightly-release",
    environment: "production",
    externalRunId: "27446843504",
    externalRunAttempt: "2",
    gitSha: "abc123",
    gitBranch: "main",
    workflowName: "AURA Observability",
    releaseChannel: "nightly",
    completedAt: "2026-06-12T22:42:12.000Z",
  });

  assert.equal(payload.source, "desktop-nightly-release");
  assert.equal(payload.environment, "production");
  assert.equal(payload.externalRunId, "27446843504");
  assert.equal(payload.externalRunAttempt, 2);
  assert.equal(payload.gitSha, "abc123");
  assert.equal(payload.gitBranch, "main");
  assert.equal(payload.workflowName, "AURA Observability");
  assert.equal(payload.releaseChannel, "nightly");
  assert.equal(payload.generatedAt, snapshot.generatedAt);
  assert.equal(payload.completedAt, "2026-06-12T22:42:12.000Z");
  assert.equal(payload.overallStatus, "major_outage");
  assert.deepEqual(payload.totals, snapshot.totals);
  assert.equal(payload.snapshot, snapshot);
});

test("buildObservabilityIngestPayload rejects snapshots without feature data", () => {
  assert.throws(
    () => buildObservabilityIngestPayload(sampleSnapshot({ features: [] })),
    /snapshot\.features must be a non-empty array/,
  );
});

test("persistObservabilityRun posts to AURA storage internal endpoint", async () => {
  let observed = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed = {
      method: request.method,
      url: request.url,
      token: request.headers["x-internal-token"],
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "stored-run-id" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const payload = buildObservabilityIngestPayload(sampleSnapshot(), {
      externalRunId: "27446843504",
    });
    const result = await persistObservabilityRun({
      storageUrl: `http://127.0.0.1:${port}`,
      token: "internal-token",
      payload,
      timeoutMs: 5_000,
    });

    assert.equal(result.id, "stored-run-id");
    assert.equal(observed.method, "POST");
    assert.equal(observed.url, "/internal/observability/runs");
    assert.equal(observed.token, "internal-token");
    assert.equal(observed.body.externalRunId, "27446843504");
    assert.equal(observed.body.snapshot.features[0].id, "remote-agents");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
