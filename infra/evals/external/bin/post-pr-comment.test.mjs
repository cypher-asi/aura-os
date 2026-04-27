// Smoke tests for post-pr-comment.mjs.
//
// Run with: node --test infra/evals/external/bin/post-pr-comment.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  countByStatus,
  countSuccess,
  formatPctDelta,
  formatCostDelta,
  main,
  parseArgs,
  renderMarkdown,
} from "./post-pr-comment.mjs";

function makeSweScore({ score = 50, instances } = {}) {
  const built = instances ?? [
    { instance_id: "django-1", status: "resolved" },
    { instance_id: "django-2", status: "not_resolved" },
    { instance_id: "django-3", status: "resolved" },
    { instance_id: "django-4", status: "agent_error" },
  ];
  const resolved = built.filter((entry) => entry.status === "resolved").length;
  const notResolved = built.length - resolved;
  return {
    benchmark: "swebench_verified",
    subset: "smoke",
    instance_count: built.length,
    aura_version: "abc1234defab",
    claude_model: "claude-3-5-sonnet",
    cost_usd: 12.345678,
    total_tokens: 543210,
    wallclock_seconds: 1860,
    score,
    resolved,
    not_resolved: notResolved,
    confidence_note: "Smoke run with 4 instances has only ~25% granularity.",
    instances: built,
  };
}

function makeBaseline({ score = 25, instances } = {}) {
  const built = instances ?? [
    { instance_id: "django-1", status: "resolved" },
    { instance_id: "django-2", status: "not_resolved" },
    { instance_id: "django-3", status: "not_resolved" },
    { instance_id: "django-4", status: "not_resolved" },
  ];
  const resolved = built.filter((entry) => entry.status === "resolved").length;
  return {
    benchmark: "swebench_verified",
    subset: "smoke",
    instance_count: built.length,
    aura_version: "0000baseline",
    claude_model: "claude-3-5-sonnet",
    cost_usd: 9.0,
    total_tokens: 412000,
    wallclock_seconds: 1500,
    score,
    resolved,
    not_resolved: built.length - resolved,
    confidence_note: "",
    instances: built,
  };
}

test("parseArgs accepts the documented flags", () => {
  const args = parseArgs([
    "--benchmark",
    "swebench_verified",
    "--score-file",
    "/tmp/score.json",
    "--baseline",
    "/tmp/baseline.json",
    "--output",
    "/tmp/summary.md",
    "--pr",
    "42",
  ]);
  assert.equal(args.benchmark, "swebench_verified");
  assert.equal(args.scoreFile, "/tmp/score.json");
  assert.equal(args.baseline, "/tmp/baseline.json");
  assert.equal(args.output, "/tmp/summary.md");
  assert.equal(args.pr, "42");
});

test("renderMarkdown without baseline produces a 3-column table with em-dash baseline values", () => {
  const score = makeSweScore({ score: 50 });
  const md = renderMarkdown({
    benchmark: "swebench_verified",
    score,
    baseline: null,
    scoreFile: "infra/evals/reports/external/swebench_verified/aura-x/score.json",
  });

  assert.match(md, /## SWE-bench Verified/);
  assert.match(md, /\| metric \| new \| baseline \|/);
  assert.doesNotMatch(md, /\| metric \| new \| baseline \| delta \|/);
  assert.match(md, /\| score \| 50\.00% \| — \|/);
  assert.match(md, /\| resolved \| 2\/4 \| — \|/);
  assert.match(md, /\| cost \| \$12\.35 \| — \|/);
});

test("renderMarkdown with baseline produces correct delta strings", () => {
  const score = makeSweScore({ score: 50 });
  const baseline = makeBaseline({ score: 25 });
  const md = renderMarkdown({
    benchmark: "swebench_verified",
    score,
    baseline,
    scoreFile: "x/score.json",
  });

  assert.match(md, /\| metric \| new \| baseline \| delta \|/);
  assert.match(md, /\| score \| 50\.00% \| 25\.00% \| \+25\.00 pp \|/);
  assert.match(md, /\| resolved \| 2\/4 \| 1\/4 \| \+1 \|/);
  assert.match(md, /\| cost \| \$12\.35 \| \$9\.00 \| \+\$3\.35 \|/);
  assert.match(md, /\| wallclock \| 31m \| 25m \| \+6m \|/);
  assert.match(md, /\| total_tokens \| 543,210 \| 412,000 \| \+131,210 \|/);
});

test("formatPctDelta handles negative and zero deltas", () => {
  assert.equal(formatPctDelta(40, 50), "-10.00 pp");
  assert.equal(formatPctDelta(50, 50), "(no change)");
  assert.equal(formatPctDelta(null, 50), "—");
  assert.equal(formatPctDelta(50, null), "—");
});

test("formatCostDelta produces a signed dollar amount", () => {
  assert.equal(formatCostDelta(10, 5), "+$5.00");
  assert.equal(formatCostDelta(5, 10), "-$5.00");
  assert.equal(formatCostDelta(5, 5), "(no change)");
});

test("renderMarkdown surfaces the confidence note as a blockquote", () => {
  const score = makeSweScore();
  const md = renderMarkdown({
    benchmark: "swebench_verified",
    score,
    baseline: null,
  });
  assert.match(md, /> \*\*Note:\*\* Smoke run with 4 instances has only ~25% granularity\./);
});

test("renderMarkdown omits the confidence-note blockquote when empty", () => {
  const score = makeSweScore();
  score.confidence_note = "";
  const md = renderMarkdown({
    benchmark: "swebench_verified",
    score,
    baseline: null,
  });
  assert.doesNotMatch(md, /> \*\*Note:\*\*/);
});

test("countByStatus returns counts that sum to instance_count", () => {
  const score = makeSweScore();
  const counts = countByStatus(score);
  let sum = 0;
  for (const v of counts.values()) sum += v;
  assert.equal(sum, score.instance_count);
  assert.equal(counts.get("resolved"), 2);
  assert.equal(counts.get("not_resolved"), 1);
  assert.equal(counts.get("agent_error"), 1);
});

test("renderMarkdown emits a per-instance status counts table that adds up", () => {
  const score = makeSweScore();
  const md = renderMarkdown({
    benchmark: "swebench_verified",
    score,
    baseline: null,
  });
  assert.match(md, /## Per-instance status counts/);
  assert.match(md, /\| resolved \| 2 \|/);
  assert.match(md, /\| not_resolved \| 1 \|/);
  assert.match(md, /\| agent_error \| 1 \|/);

  const lines = md.split("\n");
  let total = 0;
  for (const line of lines) {
    const match = /^\| (?!status\b)(?!---)([a-z_]+) \| (\d+) \|$/.exec(line.trim());
    if (match) total += Number(match[2]);
  }
  assert.equal(total, score.instance_count);
});

test("countSuccess uses 'passed' for tbench and 'resolved' for swebench", () => {
  const tbench = {
    instances: [
      { task_id: "t-1", status: "passed" },
      { task_id: "t-2", status: "failed" },
      { task_id: "t-3", status: "passed" },
    ],
  };
  assert.equal(countSuccess(tbench, "tbench_2_core"), 2);

  const swe = makeSweScore();
  assert.equal(countSuccess(swe, "swebench_verified"), 2);
});

test("main() with a missing --score-file logs a warning and exits 0", async () => {
  const stderr = [];
  const stdout = [];
  const code = await main(
    [
      "--benchmark",
      "swebench_verified",
      "--score-file",
      "/this/does/not/exist/score.json",
    ],
    {
      env: {},
      stderr: { write: (chunk) => stderr.push(String(chunk)) },
      stdout: { write: (chunk) => stdout.push(String(chunk)) },
    },
  );
  assert.equal(code, 0);
  assert.match(stderr.join(""), /could not read score\.json/i);
  assert.match(stdout.join(""), /## SWE-bench Verified/);
});

test("main() with no args at all also exits 0", async () => {
  const stderr = [];
  const code = await main([], {
    env: {},
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
    stdout: { write: () => {} },
  });
  assert.equal(code, 0);
  assert.match(stderr.join(""), /--score-file is required/);
});

test("main() reads score.json and writes to --output", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "post-pr-comment-"));
  try {
    const scoreFile = path.join(tmpDir, "score.json");
    const outputFile = path.join(tmpDir, "summary.md");
    await fs.writeFile(scoreFile, JSON.stringify(makeSweScore()), "utf8");

    const stderr = [];
    const stdout = [];
    const code = await main(
      [
        "--benchmark",
        "swebench_verified",
        "--score-file",
        scoreFile,
        "--output",
        outputFile,
      ],
      {
        env: {},
        stderr: { write: (chunk) => stderr.push(String(chunk)) },
        stdout: { write: (chunk) => stdout.push(String(chunk)) },
      },
    );
    assert.equal(code, 0);
    const onDisk = await fs.readFile(outputFile, "utf8");
    assert.match(onDisk, /## SWE-bench Verified/);
    assert.match(onDisk, /## Per-instance status counts/);
    assert.match(stdout.join(""), /## SWE-bench Verified/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
