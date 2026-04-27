import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { synthesizeSummaryFromRecords, main } from "./aggregate-score.mjs";

test("synthesizeSummaryFromRecords folds totals and date bounds from runs/*.json", () => {
  const records = new Map([
    [
      "a__a-1",
      {
        instance_id: "a__a-1",
        status: "agent_complete",
        cost_usd: 0.5,
        total_tokens: 1000,
        started_at: "2026-04-01T00:00:00.000Z",
        finished_at: "2026-04-01T00:05:00.000Z",
        patch: { tests_directory_hits_stripped: 2 },
      },
    ],
    [
      "a__a-2",
      {
        instance_id: "a__a-2",
        status: "agent_error",
        cost_usd: 0.25,
        total_tokens: 500,
        started_at: "2026-04-01T00:01:00.000Z",
        finished_at: "2026-04-01T00:10:00.000Z",
        patch: { tests_directory_hits_stripped: 0 },
      },
    ],
  ]);
  const summary = synthesizeSummaryFromRecords("/tmp/aura-run-1", records);
  assert.equal(summary.run_id, "aura-run-1");
  assert.equal(summary.instance_count, 2);
  assert.equal(summary.cost_usd, 0.75);
  assert.equal(summary.total_tokens, 1500);
  assert.equal(summary.tests_directory_hits_stripped_total, 2);
  assert.equal(summary.status_counts.agent_complete, 1);
  assert.equal(summary.status_counts.agent_error, 1);
  assert.equal(summary.started_at, "2026-04-01T00:00:00.000Z");
  assert.equal(summary.finished_at, "2026-04-01T00:10:00.000Z");
  assert.equal(summary.wallclock_seconds, 600);
  assert.equal(summary.synthesized, true);
});

test("synthesizeSummaryFromRecords copes with empty input", () => {
  const summary = synthesizeSummaryFromRecords("/tmp/aura-empty", new Map());
  assert.equal(summary.run_id, "aura-empty");
  assert.equal(summary.instance_count, 0);
  assert.equal(summary.cost_usd, 0);
  assert.equal(summary.started_at, null);
  assert.equal(summary.finished_at, null);
});

test("aggregate-score main() synthesizes driver-summary.json from runs/ when missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-agg-"));
  try {
    await fs.mkdir(path.join(dir, "runs"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "runs", "a__a-1.json"),
      JSON.stringify({
        instance_id: "a__a-1",
        repo: "a/a",
        base_commit: "deadbeef",
        status: "agent_complete",
        cost_usd: 0.1,
        total_tokens: 200,
        started_at: "2026-04-02T00:00:00.000Z",
        finished_at: "2026-04-02T00:01:00.000Z",
        patch: {
          lines: 4,
          files_changed: 1,
          files_changed_list: ["src/a.py"],
          tests_directory_hits_stripped: 0,
          empty: false,
        },
      }),
      "utf8",
    );

    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`__test_exit_${code}__`);
    };
    try {
      await main(["--out", dir]);
    } catch (error) {
      if (!String(error.message).startsWith("__test_exit_")) throw error;
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, null, `did not expect a process.exit call (got ${exitCode})`);

    const summary = JSON.parse(
      await fs.readFile(path.join(dir, "driver-summary.json"), "utf8"),
    );
    assert.equal(summary.synthesized, true);
    assert.equal(summary.instance_count, 1);

    const score = JSON.parse(
      await fs.readFile(path.join(dir, "score.json"), "utf8"),
    );
    assert.equal(score.benchmark, "swebench_verified");
    assert.equal(score.instance_count, 1);
    assert.equal(score.instances.length, 1);
    assert.equal(score.instances[0].instance_id, "a__a-1");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
