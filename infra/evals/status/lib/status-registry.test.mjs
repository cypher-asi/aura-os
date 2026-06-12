import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statusDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(statusDir, "..", "..", "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

test("every registered status check has an expected-output contract", async () => {
  const registry = await readJson("infra/evals/status/features.json");
  const expectations = await readJson("infra/evals/status/check-expectations.json");
  const checkIds = registry.features.flatMap((feature) => feature.checks.map((check) => check.id));
  const expectationIds = Object.keys(expectations.checks);

  assert.equal(new Set(checkIds).size, checkIds.length, "registry check ids must be unique");
  assert.deepEqual(
    expectationIds.filter((id) => !checkIds.includes(id)),
    [],
    "expectations must not reference unknown checks",
  );
  assert.deepEqual(
    checkIds.filter((id) => !expectationIds.includes(id)),
    [],
    "every check must declare expected evidence",
  );

  for (const id of checkIds) {
    const expectation = expectations.checks[id];
    assert.equal(typeof expectation.description, "string", `${id} must describe its pass contract`);
    assert.ok(expectation.description.length > 0, `${id} must describe its pass contract`);
    assert.ok(Array.isArray(expectation.requiredEvidence), `${id} must declare requiredEvidence`);
  }
});

test("every registered status check has a runner branch", async () => {
  const registry = await readJson("infra/evals/status/features.json");
  const runner = await readFile(path.join(repoRoot, "infra/evals/status/run-status-probes.mjs"), "utf8");
  const checkIds = registry.features.flatMap((feature) => feature.checks.map((check) => check.id));
  const missing = checkIds.filter((id) => !runner.includes(`selected("${id}")`));

  assert.deepEqual(missing, [], "every registered check must be selectable in the runner");
});

test("every registered status check has response-time thresholds", async () => {
  const registry = await readJson("infra/evals/status/features.json");
  const missing = [];
  const invalid = [];

  for (const feature of registry.features) {
    for (const check of feature.checks) {
      if (!Object.hasOwn(check, "warningLatencyMs") || !Object.hasOwn(check, "outageLatencyMs")) {
        missing.push(check.id);
        continue;
      }
      if (!(check.warningLatencyMs > 0) || !(check.outageLatencyMs > check.warningLatencyMs)) {
        invalid.push(check.id);
      }
    }
  }

  assert.deepEqual(missing, [], "every check must define warningLatencyMs and outageLatencyMs");
  assert.deepEqual(invalid, [], "every check must define positive thresholds with outage > warning");
});
