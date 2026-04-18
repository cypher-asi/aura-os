import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertStrictToolModelSupport,
  batchCommits,
  collectRubricIssues,
  validateRenderedEntry,
} from "./generate-daily-changelog.mjs";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

function buildFixtureBatches() {
  return batchCommits(readFixture("changelog-commits.json"), "America/Los_Angeles");
}

test("batchCommits groups the fixture history into stable Pacific-time sections", () => {
  const batches = buildFixtureBatches();

  assert.equal(batches.length, 4);
  assert.deepEqual(
    batches.map((batch) => batch.id),
    ["entry-1", "entry-2", "entry-3", "entry-4"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.time_label),
    ["12:00 AM", "3:50 AM", "9:10 AM", "3:00 PM"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.commits.length),
    [2, 2, 1, 1],
  );
});

test("validateRenderedEntry accepts the publication-ready fixture draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, 4);
  assert.equal(rendered.highlights.length, 4);
  assert.equal(rendered.entries[0].time_label, "12:00 AM");
  assert.equal(rendered.entries[1].items.length, 2);
});

test("collectRubricIssues flags the generic fixture draft before publication", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-bad-generic-candidate.json");

  const issues = collectRubricIssues({
    title: candidate.day_title,
    intro: candidate.day_intro,
    highlights: candidate.highlights,
    entries: candidate.entries.map((entry) => ({
      title: entry.title,
      summary: entry.summary,
      items: entry.items,
    })),
  }, batches);

  assert(issues.some((issue) => issue.includes("day title is too generic")));
  assert(issues.some((issue) => issue.includes("highlights must be unique")));
  assert(issues.some((issue) => issue.includes("is too templated")));
  assert(issues.some((issue) => issue.includes("is reused")));
  assert(issues.some((issue) => issue.includes("duplicate bullet text detected")));
});

test("validateRenderedEntry rejects the generic fixture draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-bad-generic-candidate.json");

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /Changelog rubric failed:/,
  );
});

test("assertStrictToolModelSupport rejects non-allowlisted models", () => {
  assert.throws(
    () => assertStrictToolModelSupport("claude-sonnet-4-20250514"),
    /not in the strict-tool allowlist/,
  );
});
