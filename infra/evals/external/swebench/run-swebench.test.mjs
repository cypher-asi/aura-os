import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_DIRECTIVES,
  buildRequirementsMd,
  parseArgs,
  parseDiffFiles,
  runWithPool,
  stripTestEditsFromDiff,
} from "./run-swebench.mjs";

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
  ]);
  assert.equal(parsed.subset, "smoke");
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.offset, 2);
  assert.deepEqual(parsed.instanceIds, ["a", "b", "c"]);
  assert.equal(parsed.out, "/tmp/out");
  assert.equal(parsed.keepEntities, true);
  assert.equal(parsed.stripTestEdits, false);
  assert.equal(parsed.concurrency, 4); // capped at 4
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
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
