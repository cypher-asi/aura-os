import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BENCHMARK_DIRECTIVES,
  STATUS_AGENT_PATCH_POLLUTED,
  STATUS_VERIFICATION_ENVIRONMENT_BLOCKED,
  bootstrapSwebenchPythonEnv,
  buildScenario,
  buildRequirementsMd,
  detectVerificationEnvironmentBlock,
  findLatestRunDir,
  guardSwebenchPredictionPatch,
  loadCompletedInstanceIds,
  loadPredictionInstanceIds,
  loadPriorRunRecords,
  loadRetryUnresolvedContexts,
  parseArgs,
  parseDiffFiles,
  requestContractSummaryFromPayload,
  resolveSwebenchProjectCommand,
  resolveResumeOutDir,
  runWithPool,
  shouldWritePredictionForStatus,
  SWEBENCH_DEFAULT_BUILD_COMMAND,
  SWEBENCH_DEFAULT_TEST_COMMAND,
  SWEBENCH_VENV_DIR,
  stripBenchmarkArtifactsFromDiff,
  stripTestEditsFromDiff,
  swebenchVenvPythonPath,
} from "./run-swebench.mjs";
import { extractTypedFailureReport } from "./lib/request-contract-reporting.mjs";

const SAMPLE_INSTANCE = {
  instance_id: "django__django-12345",
  repo: "django/django",
  base_commit: "abcdef0123456789",
  problem_statement: "When I run X, the system crashes with KeyError.",
};

test("BENCHMARK_DIRECTIVES is a single shared constant", () => {
  assert.equal(typeof BENCHMARK_DIRECTIVES, "string");
  assert.match(BENCHMARK_DIRECTIVES, /Benchmark constraints/);
  assert.match(BENCHMARK_DIRECTIVES, /Do not modify or delete any existing test files/);
  assert.match(BENCHMARK_DIRECTIVES, /run the repository test suite/);
  assert.match(BENCHMARK_DIRECTIVES, /full configured test command/);
  assert.match(BENCHMARK_DIRECTIVES, /call `submit_plan` with the target files/);
  assert.match(BENCHMARK_DIRECTIVES, /Create one patch-producing implementation task/);
  assert.match(BENCHMARK_DIRECTIVES, /standalone inspect, locate, or verify tasks/);
  assert.match(BENCHMARK_DIRECTIVES, /Fold inspection\/verification into the implementation task/);
  assert.match(BENCHMARK_DIRECTIVES, /self-review the final patch/);
  assert.match(BENCHMARK_DIRECTIVES, /re-read every changed source file/);
  assert.match(BENCHMARK_DIRECTIVES, /no_changes_needed: true/);
});

test("SWE-bench project commands default to real test gate and quote-safe build", () => {
  assert.equal(resolveSwebenchProjectCommand("AURA_BENCH_BUILD_COMMAND", {}), "node --version");
  assert.equal(resolveSwebenchProjectCommand("AURA_BENCH_TEST_COMMAND", {
    AURA_BENCH_TEST_COMMAND: "   ",
  }), "python -m pytest");
  assert.equal(SWEBENCH_DEFAULT_BUILD_COMMAND, "node --version");
  assert.equal(SWEBENCH_DEFAULT_TEST_COMMAND, "python -m pytest");
});

test("SWE-bench project command honours explicit operator overrides", () => {
  assert.equal(resolveSwebenchProjectCommand("AURA_BENCH_TEST_COMMAND", {
    AURA_BENCH_TEST_COMMAND: "python -m pytest -q",
  }), "python -m pytest -q");
});

test("buildScenario can route the test gate through a prepared venv", () => {
  const scenario = buildScenario(SAMPLE_INSTANCE, "/tmp/workspace", {
    testCommand: "\"/tmp/workspace/.venv-swebench/bin/python\" -m pytest",
    pythonEnv: {
      testCommand: "\"/tmp/workspace/.venv-swebench/bin/python\" -m pytest",
    },
  });

  assert.equal(
    scenario.project.testCommand,
    "\"/tmp/workspace/.venv-swebench/bin/python\" -m pytest",
  );
  assert.match(scenario.agentTemplate.systemPrompt, /prepared benchmark Python environment/);
  assert.match(scenario.agentTemplate.systemPrompt, /Do not use global Python/);
});

test("swebenchVenvPythonPath returns platform-specific venv python paths", () => {
  assert.equal(
    swebenchVenvPythonPath("C:/tmp/workspace", "win32").replaceAll("\\", "/"),
    `C:/tmp/workspace/${SWEBENCH_VENV_DIR}/Scripts/python.exe`,
  );
  assert.equal(
    swebenchVenvPythonPath("/tmp/workspace", "linux").replaceAll("\\", "/"),
    `/tmp/workspace/${SWEBENCH_VENV_DIR}/bin/python`,
  );
});

test("bootstrapSwebenchPythonEnv only auto-enables venv on native Windows", async () => {
  const result = await bootstrapSwebenchPythonEnv("/tmp/workspace", {
    env: {},
    platform: "linux",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.testCommand, "python -m pytest");
});

test("Cloudflare-blocked statuses do not write predictions", () => {
  assert.equal(shouldWritePredictionForStatus("agent_complete"), true);
  assert.equal(shouldWritePredictionForStatus("agent_error"), true);
  assert.equal(shouldWritePredictionForStatus(STATUS_AGENT_PATCH_POLLUTED), true);
  assert.equal(shouldWritePredictionForStatus(STATUS_VERIFICATION_ENVIRONMENT_BLOCKED), true);
  assert.equal(shouldWritePredictionForStatus("blocked_cloudflare"), false);
  assert.equal(shouldWritePredictionForStatus("skipped_cloudflare_block"), false);
});

test("request contract payload summaries accept forward-compatible classifier shapes", () => {
  const summary = requestContractSummaryFromPayload({
    requestContractReports: [
      {
        verdict: "Accept",
        requestKind: "DevLoopBootstrap",
        contentSignature: "sig-ok",
      },
      {
        verdict: "Block",
        request_kind: "ProjectToolTaskExtract",
        content_signature: "sig-bad",
        reasons: [{ code: "MissingStableSessionId", message: "project tool session id is empty" }],
      },
    ],
  });

  assert.equal(summary.available, true);
  assert.equal(summary.acceptance, "fail");
  assert.equal(summary.accepted, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.first_blocked.request_kind, "ProjectToolTaskExtract");
  assert.deepEqual(summary.verdict_counts, { accept: 1, block: 1 });
});

test("typed failure reports compact Cloudflare HTML into actionable local output", () => {
  const html = "<!DOCTYPE html><html><title>Attention Required! | Cloudflare</title>"
    + "<span>cf-ray: abc123-SJC</span></html>";
  const report = extractTypedFailureReport({ error: new Error(`spec stream HTTP 403: ${html}`) });

  assert.equal(report.type, "cloudflare_block");
  assert.match(report.message, /Cloudflare HTML 403/);
  assert.match(report.message, /cf-ray=abc123-SJC/);
  assert.ok(!report.message.includes("<!DOCTYPE html>"));
});

test("SWE-bench scenarios cool down between task extraction and loop start", () => {
  const previous = process.env.AURA_BENCH_MODEL_COOLDOWN_MS;
  try {
    delete process.env.AURA_BENCH_MODEL_COOLDOWN_MS;
    const scenario = buildScenario(SAMPLE_INSTANCE, "/tmp/workspace");
    assert.equal(scenario.timeouts.modelCooldownMs, 1_000);

    process.env.AURA_BENCH_MODEL_COOLDOWN_MS = "1234";
    const overridden = buildScenario(SAMPLE_INSTANCE, "/tmp/workspace");
    assert.equal(overridden.timeouts.modelCooldownMs, 1_000);

    process.env.AURA_BENCH_MODEL_COOLDOWN_MS = "250";
    const faster = buildScenario(SAMPLE_INSTANCE, "/tmp/workspace");
    assert.equal(faster.timeouts.modelCooldownMs, 250);
  } finally {
    if (previous === undefined) {
      delete process.env.AURA_BENCH_MODEL_COOLDOWN_MS;
    } else {
      process.env.AURA_BENCH_MODEL_COOLDOWN_MS = previous;
    }
  }
});

test("buildRequirementsMd emits the expected sections without hints", () => {
  const md = buildRequirementsMd(SAMPLE_INSTANCE);
  assert.match(md, /^# SWE-bench instance: django__django-12345$/m);
  assert.match(md, /^Repo: django\/django$/m);
  assert.match(md, /^Base commit: abcdef0123456789$/m);
  assert.match(md, /## Problem statement/);
  assert.match(md, /KeyError/);
  assert.ok(!/## Discussion \(issue hints\)/.test(md), "should omit Discussion when hints_text is empty");
  assert.match(md, /## Benchmark constraints/);
});

test("buildRequirementsMd includes hints_text when provided", () => {
  const md = buildRequirementsMd({
    ...SAMPLE_INSTANCE,
    hints_text: "The maintainer suggested looking at apps/registry.py.",
  });
  assert.match(md, /## Discussion \(issue hints\)/);
  assert.match(md, /apps\/registry\.py/);
});

test("buildRequirementsMd handles whitespace-only hints by omitting the section", () => {
  const md = buildRequirementsMd({
    ...SAMPLE_INSTANCE,
    hints_text: "   \n\n   ",
  });
  assert.ok(!/## Discussion \(issue hints\)/.test(md));
});

test("buildRequirementsMd includes retry context when provided", () => {
  const md = buildRequirementsMd(SAMPLE_INSTANCE, {
    status: "not_resolved",
    failed_to_pass_results: { failure: ["test_regression"] },
    previous_patch_summary: "12 patch lines, 1 files changed",
  });
  assert.match(md, /## Previous official evaluation/);
  assert.match(md, /Prior status: not_resolved/);
  assert.match(md, /test_regression/);
  assert.match(md, /Previous patch summary: 12 patch lines, 1 files changed/);
});

test("buildRequirementsMd throws when instance is missing", () => {
  assert.throws(() => buildRequirementsMd(null), /instance is required/);
});

test("parseDiffFiles reports the unique files touched by a patch", () => {
  const diff = [
    "diff --git a/src/foo.py b/src/foo.py",
    "index 1111111..2222222 100644",
    "--- a/src/foo.py",
    "+++ b/src/foo.py",
    "@@ -1,2 +1,3 @@",
    " a",
    "+b",
    " c",
    "diff --git a/src/bar.py b/src/bar.py",
    "index 3333333..4444444 100644",
    "--- a/src/bar.py",
    "+++ b/src/bar.py",
    "@@ -1 +1,2 @@",
    " x",
    "+y",
    "",
  ].join("\n");

  const files = parseDiffFiles(diff);
  assert.deepEqual(files.sort(), ["src/bar.py", "src/foo.py"]);
});

test("parseDiffFiles handles new-file diffs (--- /dev/null)", () => {
  const diff = [
    "diff --git a/src/added.py b/src/added.py",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/src/added.py",
    "@@ -0,0 +1,2 @@",
    "+hello",
    "+world",
    "",
  ].join("\n");

  assert.deepEqual(parseDiffFiles(diff), ["src/added.py"]);
});

test("parseDiffFiles returns an empty list for an empty diff", () => {
  assert.deepEqual(parseDiffFiles(""), []);
  assert.deepEqual(parseDiffFiles(null), []);
});

test("stripTestEditsFromDiff removes hunks under tests/, test/, and *_test.py", () => {
  const diff = [
    "diff --git a/src/foo.py b/src/foo.py",
    "index 1111111..2222222 100644",
    "--- a/src/foo.py",
    "+++ b/src/foo.py",
    "@@ -1 +1,2 @@",
    " keep",
    "+keep-me",
    "diff --git a/tests/test_alpha.py b/tests/test_alpha.py",
    "index 3333333..4444444 100644",
    "--- a/tests/test_alpha.py",
    "+++ b/tests/test_alpha.py",
    "@@ -1 +1,2 @@",
    " strip",
    "+stripped",
    "diff --git a/pkg/test/helpers.py b/pkg/test/helpers.py",
    "index 5555555..6666666 100644",
    "--- a/pkg/test/helpers.py",
    "+++ b/pkg/test/helpers.py",
    "@@ -1 +1,2 @@",
    " strip",
    "+stripped",
    "diff --git a/pkg/foo_test.py b/pkg/foo_test.py",
    "index 7777777..8888888 100644",
    "--- a/pkg/foo_test.py",
    "+++ b/pkg/foo_test.py",
    "@@ -1 +1,2 @@",
    " strip",
    "+stripped",
    "diff --git a/pkg/test_helpers.py b/pkg/test_helpers.py",
    "index 9999999..aaaaaaa 100644",
    "--- a/pkg/test_helpers.py",
    "+++ b/pkg/test_helpers.py",
    "@@ -1 +1,2 @@",
    " strip",
    "+stripped",
    "diff --git a/pkg/tests.py b/pkg/tests.py",
    "index bbbbbbb..ccccccc 100644",
    "--- a/pkg/tests.py",
    "+++ b/pkg/tests.py",
    "@@ -1 +1,2 @@",
    " strip",
    "+stripped",
    "",
  ].join("\n");

  const result = stripTestEditsFromDiff(diff);
  assert.equal(result.strippedHunks, 5);
  assert.match(result.patch, /diff --git a\/src\/foo\.py b\/src\/foo\.py/);
  assert.ok(!/tests\/test_alpha\.py/.test(result.patch));
  assert.ok(!/pkg\/test\/helpers\.py/.test(result.patch));
  assert.ok(!/pkg\/foo_test\.py/.test(result.patch));
  assert.ok(!/pkg\/test_helpers\.py/.test(result.patch));
  assert.ok(!/pkg\/tests\.py/.test(result.patch));
});

test("stripTestEditsFromDiff also catches renames between test and non-test paths", () => {
  const diff = [
    "diff --git a/src/foo.py b/tests/test_foo.py",
    "similarity index 100%",
    "rename from src/foo.py",
    "rename to tests/test_foo.py",
    "",
  ].join("\n");

  const result = stripTestEditsFromDiff(diff);
  assert.equal(result.strippedHunks, 1);
  assert.equal(result.patch, "");
});

test("stripTestEditsFromDiff is a no-op when no hunks touch tests", () => {
  const diff = [
    "diff --git a/src/foo.py b/src/foo.py",
    "index 1111111..2222222 100644",
    "--- a/src/foo.py",
    "+++ b/src/foo.py",
    "@@ -1 +1,2 @@",
    " keep",
    "+keep-me",
    "",
  ].join("\n");

  const result = stripTestEditsFromDiff(diff);
  assert.equal(result.strippedHunks, 0);
  assert.equal(result.patch, diff);
});

test("stripTestEditsFromDiff handles empty input", () => {
  assert.deepEqual(stripTestEditsFromDiff(""), { patch: "", strippedHunks: 0 });
  assert.deepEqual(stripTestEditsFromDiff(null), { patch: "", strippedHunks: 0 });
});

test("stripBenchmarkArtifactsFromDiff removes benchmark setup files only", () => {
  const diff = [
    "diff --git a/requirements.md b/requirements.md",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/requirements.md",
    "@@ -0,0 +1 @@",
    "+benchmark prompt",
    "diff --git a/spec/01-fix.md b/spec/01-fix.md",
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    "+++ b/spec/01-fix.md",
    "@@ -0,0 +1 @@",
    "+generated spec",
    "diff --git a/src/foo.py b/src/foo.py",
    "index 3333333..4444444 100644",
    "--- a/src/foo.py",
    "+++ b/src/foo.py",
    "@@ -1 +1,2 @@",
    " keep",
    "+keep-me",
    "",
  ].join("\n");

  const result = stripBenchmarkArtifactsFromDiff(diff);
  assert.equal(result.strippedHunks, 2);
  assert.match(result.patch, /diff --git a\/src\/foo\.py b\/src\/foo\.py/);
  assert.ok(!/requirements\.md/.test(result.patch));
  assert.ok(!/spec\/01-fix\.md/.test(result.patch));
});

test("stripBenchmarkArtifactsFromDiff removes local SWE-bench venv artifacts", () => {
  const diff = [
    `diff --git a/${SWEBENCH_VENV_DIR}/pyvenv.cfg b/${SWEBENCH_VENV_DIR}/pyvenv.cfg`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${SWEBENCH_VENV_DIR}/pyvenv.cfg`,
    "@@ -0,0 +1 @@",
    "+home = C:/Python310",
    "diff --git a/src/module.py b/src/module.py",
    "index 1111111..2222222 100644",
    "--- a/src/module.py",
    "+++ b/src/module.py",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const result = stripBenchmarkArtifactsFromDiff(diff);

  assert.equal(result.strippedHunks, 1);
  assert.match(result.patch, /src\/module.py/);
  assert.doesNotMatch(result.patch, /pyvenv\.cfg/);
});

test("stripBenchmarkArtifactsFromDiff handles empty input", () => {
  assert.deepEqual(stripBenchmarkArtifactsFromDiff(""), { patch: "", strippedHunks: 0 });
  assert.deepEqual(stripBenchmarkArtifactsFromDiff(null), { patch: "", strippedHunks: 0 });
});

test("guardSwebenchPredictionPatch strips latest Astropy environment workaround pollution", async () => {
  const predictionPath = path.resolve(
    "infra/evals/reports/external/swebench_verified",
    "aura-3901736b4bf5-20260429-193041",
    "predictions.jsonl",
  );
  const [line] = (await fs.readFile(predictionPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  const prediction = JSON.parse(line);

  const result = guardSwebenchPredictionPatch({
    patch: prediction.model_patch,
    instance: {
      instance_id: "astropy__astropy-12907",
      problem_statement: "Separability matrix for nested compound models is incorrect.",
    },
    auraPayload: {
      taskOutputs: {
        task: {
          output: "The astropy environment has issues unrelated to my change: LoggingError and broken extension build with new MSVC.",
        },
      },
    },
    platform: "win32",
  });

  assert.equal(result.status, STATUS_AGENT_PATCH_POLLUTED);
  assert.deepEqual(
    result.polluted_files.sort(),
    ["astropy/logger.py", "astropy/utils/_compiler.py"],
  );
  assert.deepEqual(result.preserved_files, ["astropy/modeling/separable.py"]);
  assert.match(result.patch, /diff --git a\/astropy\/modeling\/separable\.py b\/astropy\/modeling\/separable\.py/);
  assert.match(result.patch, /cright\[-right\.shape\[0\]:, -right\.shape\[1\]:\] = right/);
  assert.ok(!/astropy\/logger\.py/.test(result.patch));
  assert.ok(!/astropy\/utils\/_compiler\.py/.test(result.patch));
  assert.equal(result.environment.blocked, true);
});

test("guardSwebenchPredictionPatch preserves logger edits when the issue is about logging", () => {
  const diff = [
    "diff --git a/astropy/logger.py b/astropy/logger.py",
    "index 1111111..2222222 100644",
    "--- a/astropy/logger.py",
    "+++ b/astropy/logger.py",
    "@@ -1 +1,2 @@",
    " keep",
    "+raise LoggingError('real logging bug')",
    "",
  ].join("\n");

  const result = guardSwebenchPredictionPatch({
    patch: diff,
    instance: {
      problem_statement: "Astropy logger emits incorrect warnings when logging is enabled.",
    },
    platform: "linux",
  });

  assert.equal(result.status, null);
  assert.deepEqual(result.polluted_files, []);
  assert.equal(result.patch, diff);
});

test("detectVerificationEnvironmentBlock marks native Windows setup failures as typed blockers", () => {
  const result = detectVerificationEnvironmentBlock({
    auraPayload: {
      taskOutputs: {
        task: {
          output: "The test infrastructure cannot run due to LoggingError and a broken extension build with new MSVC.",
        },
      },
    },
    platform: "win32",
  });

  assert.equal(result.blocked, true);
  assert.equal(result.platform, "win32");
  assert.ok(result.evidence.includes("agent_reported_environment_blocker"));
});

test("parseArgs supports the documented CLI flags", () => {
  const parsed = parseArgs([
    "--subset",
    "smoke",
    "--limit",
    "5",
    "--offset",
    "2",
    "--instance-ids",
    "a,b , c",
    "--out",
    "/tmp/out",
    "--keep-entities",
    "--no-strip-test-edits",
    "--concurrency",
    "8",
    "--retry-unresolved-from",
    "/tmp/score-run",
  ]);
  assert.equal(parsed.subset, "smoke");
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.offset, 2);
  assert.deepEqual(parsed.instanceIds, ["a", "b", "c"]);
  assert.equal(parsed.out, "/tmp/out");
  assert.equal(parsed.keepEntities, true);
  assert.equal(parsed.stripTestEdits, false);
  assert.equal(parsed.concurrency, 4); // capped at 4
  assert.equal(parsed.retryUnresolvedFrom, "/tmp/score-run");
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("parseArgs supports bare --resume (auto-pick latest)", () => {
  const parsed = parseArgs(["--subset", "smoke", "--resume"]);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.resumeValue, null);
  assert.equal(parsed.resumeIncludeErrors, false);
});

test("parseArgs supports --resume <run-id> (space-separated)", () => {
  const parsed = parseArgs(["--resume", "aura-abc-20260101-000000", "--limit", "5"]);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.resumeValue, "aura-abc-20260101-000000");
  assert.equal(parsed.limit, 5);
});

test("parseArgs supports --resume=<run-id> (inline value)", () => {
  const parsed = parseArgs(["--resume=aura-zzz-1"]);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.resumeValue, "aura-zzz-1");
});

test("parseArgs treats --resume followed by another flag as bare", () => {
  const parsed = parseArgs(["--resume", "--limit", "3"]);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.resumeValue, null);
  assert.equal(parsed.limit, 3);
});

test("parseArgs parses --resume-include-errors", () => {
  const parsed = parseArgs(["--resume", "--resume-include-errors"]);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.resumeIncludeErrors, true);
});

async function makeTempRunDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-resume-"));
  await fs.mkdir(path.join(dir, "runs"), { recursive: true });
  return dir;
}

async function writeRunRecord(outDir, instanceId, partial) {
  await fs.writeFile(
    path.join(outDir, "runs", `${instanceId}.json`),
    JSON.stringify({ instance_id: instanceId, ...partial }, null, 2),
    "utf8",
  );
}

test("loadCompletedInstanceIds picks final statuses and skips agent_error by default", async () => {
  const dir = await makeTempRunDir();
  try {
    await writeRunRecord(dir, "a__a-1", { status: "agent_complete" });
    await writeRunRecord(dir, "a__a-2", { status: "clone_error" });
    await writeRunRecord(dir, "a__a-3", { status: "skipped_cost_cap" });
    await writeRunRecord(dir, "a__a-4", { status: "agent_error" });

    const ids = await loadCompletedInstanceIds(dir);
    assert.deepEqual(
      Array.from(ids).sort(),
      ["a__a-1", "a__a-2", "a__a-3"],
    );

    const idsWithErrors = await loadCompletedInstanceIds(dir, {
      includeErrors: true,
    });
    assert.deepEqual(
      Array.from(idsWithErrors).sort(),
      ["a__a-1", "a__a-2", "a__a-3", "a__a-4"],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadCompletedInstanceIds returns empty set when runs/ is missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-resume-"));
  try {
    const ids = await loadCompletedInstanceIds(dir);
    assert.equal(ids.size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadPredictionInstanceIds parses each line and ignores blanks/junk", async () => {
  const dir = await makeTempRunDir();
  try {
    const lines = [
      JSON.stringify({ instance_id: "x__x-1", model_patch: "" }),
      "",
      "not-json",
      JSON.stringify({ instance_id: "x__x-2", model_patch: "patch" }),
      "",
    ];
    await fs.writeFile(
      path.join(dir, "predictions.jsonl"),
      `${lines.join("\n")}\n`,
      "utf8",
    );
    const ids = await loadPredictionInstanceIds(dir);
    assert.deepEqual(Array.from(ids).sort(), ["x__x-1", "x__x-2"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadRetryUnresolvedContexts selects unresolved score entries", async () => {
  const dir = await makeTempRunDir();
  try {
    await fs.writeFile(
      path.join(dir, "score.json"),
      JSON.stringify({
        instances: [
          { instance_id: "a__a-1", status: "resolved", model_patch_lines: 3, files_changed: 1 },
          {
            instance_id: "a__a-2",
            status: "not_resolved",
            model_patch_lines: 9,
            files_changed: 2,
            failed_to_pass_results: { failure: ["test_bug"] },
          },
          { instance_id: "a__a-3", status: "agent_error" },
        ],
      }),
      "utf8",
    );

    const contexts = await loadRetryUnresolvedContexts(dir);
    assert.deepEqual(Array.from(contexts.keys()).sort(), ["a__a-2", "a__a-3"]);
    assert.equal(contexts.get("a__a-2").status, "not_resolved");
    assert.deepEqual(contexts.get("a__a-2").failed_to_pass_results, { failure: ["test_bug"] });
    assert.equal(contexts.get("a__a-2").previous_patch_summary, "9 patch lines, 2 files changed");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadPriorRunRecords loads every parseable runs/*.json keyed by instance_id", async () => {
  const dir = await makeTempRunDir();
  try {
    await writeRunRecord(dir, "p__p-1", { status: "agent_complete", cost_usd: 0.5 });
    await writeRunRecord(dir, "p__p-2", { status: "agent_error", cost_usd: 0.25 });
    await fs.writeFile(path.join(dir, "runs", "garbage.json"), "{ not json", "utf8");

    const map = await loadPriorRunRecords(dir);
    assert.equal(map.size, 2);
    assert.equal(map.get("p__p-1").status, "agent_complete");
    assert.equal(map.get("p__p-2").cost_usd, 0.25);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findLatestRunDir picks the most recently modified aura-* directory", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-runs-"));
  try {
    const older = path.join(parent, "aura-old-20240101-000000");
    const newer = path.join(parent, "aura-new-20260101-000000");
    const unrelated = path.join(parent, "not-a-run");
    await fs.mkdir(older);
    await fs.mkdir(newer);
    await fs.mkdir(unrelated);
    const past = new Date("2024-01-01T00:00:00Z");
    const future = new Date("2026-01-01T00:00:00Z");
    await fs.utimes(older, past, past);
    await fs.utimes(newer, future, future);

    const latest = await findLatestRunDir(parent);
    assert.equal(latest, newer);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("findLatestRunDir returns null when the parent does not exist", async () => {
  const ghost = path.join(os.tmpdir(), `swebench-no-such-${process.pid}-${Date.now()}`);
  const latest = await findLatestRunDir(ghost);
  assert.equal(latest, null);
});

test("resolveResumeOutDir auto-picks the most recent run when no value is given", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-root-"));
  try {
    const parent = path.join(
      root,
      "infra",
      "evals",
      "reports",
      "external",
      "swebench_verified",
    );
    const runDir = path.join(parent, "aura-zzz-20260101-000000");
    await fs.mkdir(runDir, { recursive: true });

    const resolved = await resolveResumeOutDir({
      resumeValue: null,
      explicitOut: null,
      rootDir: root,
    });
    assert.equal(resolved, runDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveResumeOutDir resolves a RUN_ID under the standard reports dir", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-root-"));
  try {
    const parent = path.join(
      root,
      "infra",
      "evals",
      "reports",
      "external",
      "swebench_verified",
    );
    const runDir = path.join(parent, "aura-id-1");
    await fs.mkdir(runDir, { recursive: true });

    const resolved = await resolveResumeOutDir({
      resumeValue: "aura-id-1",
      explicitOut: null,
      rootDir: root,
    });
    assert.equal(resolved, runDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveResumeOutDir accepts an absolute path value", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-explicit-"));
  try {
    const resolved = await resolveResumeOutDir({
      resumeValue: dir,
      explicitOut: null,
      rootDir: os.tmpdir(),
    });
    assert.equal(resolved, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("resolveResumeOutDir throws with a clear message when the target is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-root-"));
  try {
    await assert.rejects(
      resolveResumeOutDir({
        resumeValue: "aura-does-not-exist",
        explicitOut: null,
        rootDir: root,
      }),
      /resume target .* does not exist/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveResumeOutDir prefers an explicit --out when it exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swebench-explicit-"));
  try {
    const resolved = await resolveResumeOutDir({
      resumeValue: "aura-something-else",
      explicitOut: dir,
      rootDir: os.tmpdir(),
    });
    assert.equal(resolved, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runWithPool runs items in parallel up to the concurrency cap", async () => {
  const items = [1, 2, 3, 4, 5];
  let active = 0;
  let peak = 0;
  const worker = async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item * 2;
  };
  const results = await runWithPool(items, 3, worker);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.ok(peak <= 3, `peak concurrency should be <= 3, got ${peak}`);
});
