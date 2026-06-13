import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
