import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "infra/evals/status/build-status-snapshot.mjs");
const bundledSnapshot = path.join(repoRoot, "interface/public/observability/status.json");

function cleanEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.AURA_STATUS_OUTPUT;
  delete env.AURA_STATUS_REPORT_OUTPUT;
  return env;
}

test("build-status-snapshot writes one configured snapshot file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-snapshot-"));
  try {
    const out = path.join(tempDir, "status.json");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--checks-dir",
        path.join(tempDir, "checks"),
        "--out",
        out,
        "--environment",
        "test",
        "--source",
        "unit-test",
      ],
      {
        cwd: repoRoot,
        env: cleanEnv(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /interface\/public\/observability\/status\.json/);

    const snapshot = JSON.parse(await readFile(out, "utf8"));
    assert.equal(snapshot.environment, "test");
    assert.equal(snapshot.source, "unit-test");
    await assert.rejects(access(bundledSnapshot), /ENOENT/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("build-status-snapshot rejects divergent output aliases", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-snapshot-"));
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AURA_STATUS_OUTPUT: path.join(tempDir, "status.json"),
        AURA_STATUS_REPORT_OUTPUT: path.join(tempDir, "report-status.json"),
      },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /AURA_STATUS_OUTPUT and AURA_STATUS_REPORT_OUTPUT must point to the same snapshot file/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("build-status-snapshot attaches investigation artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-snapshot-"));
  try {
    const checksDir = path.join(tempDir, "checks");
    const investigationsDir = path.join(tempDir, "investigations");
    const registry = path.join(tempDir, "features.json");
    const out = path.join(tempDir, "status.json");
    await mkdir(checksDir, { recursive: true });
    await mkdir(investigationsDir, { recursive: true });
    await writeFile(registry, JSON.stringify({
      title: "AURA Observability",
      features: [
        {
          id: "models",
          label: "Models",
          category: "models",
          priority: 1,
          checks: [{ id: "model-matrix", required: true, staleAfterMinutes: 10 }],
          outageAfterFailures: 1,
        },
      ],
    }));
    await writeFile(path.join(checksDir, "checks.json"), JSON.stringify({
      generatedAt: "2026-06-10T12:00:00.000Z",
      checks: [
        {
          checkId: "model-matrix",
          featureId: "models",
          status: "fail",
          message: "model failed",
          endedAt: "2026-06-10T12:00:00.000Z",
          evidence: { failedModels: ["aura-small"] },
        },
      ],
    }));
    await writeFile(path.join(investigationsDir, "investigations.json"), JSON.stringify({
      investigations: [
        {
          schemaVersion: 1,
          kind: "llm-investigation",
          id: "models:model-matrix:investigator",
          featureId: "models",
          featureLabel: "Models",
          checkId: "model-matrix",
          title: "Model matrix failure",
          status: "ready",
          generatedAt: "2026-06-10T12:00:00.000Z",
          confidence: "medium",
          summary: "A model failed.",
          rootCause: "The model-authored report points to aura-small.",
          proof: ["failedModels includes aura-small"],
        },
      ],
    }));

    const result = spawnSync(
      process.execPath,
      [
        script,
        "--checks-dir",
        checksDir,
        "--investigations-dir",
        investigationsDir,
        "--registry",
        registry,
        "--out",
        out,
        "--environment",
        "test",
        "--source",
        "unit-test",
      ],
      {
        cwd: repoRoot,
        env: cleanEnv(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(await readFile(out, "utf8"));
    assert.equal(snapshot.totals.investigations, 1);
    assert.equal(snapshot.features[0].checks[0].investigation.title, "Model matrix failure");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
