import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildHarnessIndex,
  buildPostmortem,
  failureBucket,
  loadHarnessReport,
  normalizeStatus,
  synthesizeSummaryFromRecords,
  main,
} from "./aggregate-score.mjs";

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

test("buildPostmortem buckets unresolved instances by likely failure mode", () => {
  const postmortem = buildPostmortem({
    benchmark: "swebench_verified",
    subset: "smoke",
    scoring_mode: "official_harness",
    official_harness_ran: true,
    resolved: 1,
    not_resolved: 3,
    score: 25,
    instances: [
      { instance_id: "a__a-1", status: "resolved" },
      { instance_id: "a__a-2", status: "agent_error", files_changed: 1 },
      { instance_id: "a__a-3", status: "not_resolved", files_changed: 0 },
      {
        instance_id: "a__a-4",
        status: "not_resolved",
        files_changed: 1,
        failed_to_pass_results: { failure: ["test_bug"] },
      },
    ],
  });

  assert.equal(failureBucket({ status: "resolved" }), "resolved");
  assert.equal(failureBucket({ status: "agent_patch_polluted" }), "agent_patch_polluted");
  assert.equal(
    failureBucket({ status: "verification_environment_blocked" }),
    "verification_environment_blocked",
  );
  assert.equal(postmortem.buckets.resolved, 1);
  assert.equal(postmortem.buckets.dev_loop_failure, 1);
  assert.equal(postmortem.buckets.empty_or_filtered_patch, 1);
  assert.equal(postmortem.buckets.hidden_test_failure, 1);
  assert.deepEqual(
    postmortem.unresolved.map((entry) => entry.instance_id),
    ["a__a-2", "a__a-3", "a__a-4"],
  );
});

test("normalizeStatus preserves typed driver guardrail outcomes without official harness results", () => {
  assert.equal(
    normalizeStatus(null, { status: "agent_patch_polluted" }),
    "agent_patch_polluted",
  );
  assert.equal(
    normalizeStatus(null, { status: "verification_environment_blocked" }),
    "verification_environment_blocked",
  );
  assert.equal(
    normalizeStatus({ resolved: true }, { status: "agent_patch_polluted" }),
    "resolved",
  );
});

test("buildHarnessIndex treats submitted-only official ids as unresolved", () => {
  const index = buildHarnessIndex({
    resolved_ids: ["a__a-1"],
    submitted_ids: ["a__a-1", "a__a-2"],
    empty_patch_ids: ["a__a-3"],
  }, {});

  assert.equal(index.get("a__a-1").resolved, true);
  assert.equal(index.get("a__a-2").resolved, false);
  assert.equal(index.get("a__a-3").resolved, false);
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
    assert.equal(
      score.scoring_mode,
      process.platform === "win32" ? "driver_only_native_windows" : "driver_predictions_only",
    );
    assert.equal(score.official_harness_ran, false);
    assert.match(
      score.scoring_note,
      process.platform === "win32"
        ? /Native Windows run is driver-only plumbing validation/
        : /Official SWE-bench hidden-test scoring did not run/,
    );
    assert.equal(score.instances.length, 1);
    assert.equal(score.instances[0].instance_id, "a__a-1");
    const postmortem = JSON.parse(
      await fs.readFile(path.join(dir, "postmortem.json"), "utf8"),
    );
    assert.equal(postmortem.scoring_mode, score.scoring_mode);
    assert.equal(postmortem.buckets.not_resolved ?? 0, 0);
    assert.match(
      await fs.readFile(path.join(dir, "postmortem.md"), "utf8"),
      /SWE-bench Postmortem/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("aggregate-score marks official scoring when harness report is present", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-agg-harness-"));
  try {
    await fs.mkdir(path.join(dir, "runs"), { recursive: true });
    await fs.mkdir(path.join(dir, "harness-report"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "driver-summary.json"),
      JSON.stringify({
        run_id: "aura-test",
        subset: "smoke",
        instance_count: 1,
        cost_usd: 0,
        total_tokens: 0,
        wallclock_seconds: 1,
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "runs", "a__a-1.json"),
      JSON.stringify({
        instance_id: "a__a-1",
        repo: "a/a",
        base_commit: "deadbeef",
        status: "agent_complete",
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
    await fs.writeFile(
      path.join(dir, "harness-report", "report.json"),
      JSON.stringify({
        total_instances: 1,
        resolved_instances: ["a__a-1"],
        submitted_instances: ["a__a-1"],
      }),
      "utf8",
    );

    await main(["--out", dir]);

    const score = JSON.parse(
      await fs.readFile(path.join(dir, "score.json"), "utf8"),
    );
    assert.equal(score.scoring_mode, "official_harness");
    assert.equal(score.official_harness_ran, true);
    assert.equal(score.scoring_note, "");
    assert.equal(score.resolved, 1);
    assert.equal(score.instances[0].status, "resolved");
    const postmortem = JSON.parse(
      await fs.readFile(path.join(dir, "postmortem.json"), "utf8"),
    );
    assert.equal(postmortem.buckets.resolved, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("aggregate-score discovers misplaced AURA.<run_id>.json harness report", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-agg-fallback-"));
  const previousCwd = process.cwd();
  try {
    await fs.mkdir(path.join(dir, "runs"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "driver-summary.json"),
      JSON.stringify({
        run_id: "aura-fallback",
        subset: "smoke",
        instance_count: 2,
        cost_usd: 0,
        total_tokens: 0,
        wallclock_seconds: 1,
      }),
      "utf8",
    );
    for (const instanceId of ["a__a-1", "a__a-2"]) {
      await fs.writeFile(
        path.join(dir, "runs", `${instanceId}.json`),
        JSON.stringify({
          instance_id: instanceId,
          repo: "a/a",
          base_commit: "deadbeef",
          status: "agent_complete",
          aura_payload: {
            richUsageSummary: {
              totalInputTokens: 10,
              totalOutputTokens: 5,
              totalCacheCreationInputTokens: 2,
              totalCacheReadInputTokens: 3,
            },
          },
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
    }
    await fs.writeFile(
      path.join(dir, "AURA.aura-fallback.json"),
      JSON.stringify({
        total_instances: 500,
        submitted_instances: ["a__a-1", "a__a-2"],
        resolved_ids: ["a__a-1"],
        unresolved_ids: ["a__a-2"],
      }),
      "utf8",
    );

    process.chdir(os.tmpdir());
    const harness = await loadHarnessReport(dir, { runId: "aura-fallback" });
    assert.equal(harness.foundHarnessOutput, true);
    assert.equal(harness.sources.length, 1);

    await main(["--out", dir]);

    const score = JSON.parse(
      await fs.readFile(path.join(dir, "score.json"), "utf8"),
    );
    assert.equal(score.scoring_mode, "official_harness");
    assert.equal(score.resolved, 1);
    assert.equal(score.not_resolved, 1);
    assert.equal(score.total_tokens, 40);
    assert.deepEqual(
      score.instances.map((entry) => [entry.instance_id, entry.status]),
      [["a__a-1", "resolved"], ["a__a-2", "not_resolved"]],
    );
    assert.match(score.scoring_source.harness_report_paths[0], /AURA\.aura-fallback\.json$/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
