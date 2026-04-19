import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertStrictToolModelSupport,
  batchCommits,
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

test("validateRenderedEntry accepts a structurally valid generic draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-bad-generic-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, candidate.entries.length);
  assert.equal(rendered.highlights.length, candidate.highlights.length);
});

test("validateRenderedEntry rejects entries that reference unknown batches", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].batch_id = "entry-999";

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must reference a known batch/,
  );
});

test("validateRenderedEntry rejects bullets without valid SHAs from the batch", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].items[0].commit_shas = ["not-a-real-sha"];

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry item must cite at least one SHA from batch entry-1/,
  );
});

test("validateRenderedEntry rejects duplicate batch entries", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[1].batch_id = candidate.entries[0].batch_id;

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must be unique/,
  );
});

test("assertStrictToolModelSupport warns instead of failing for non-allowlisted models", () => {
  assert.equal(assertStrictToolModelSupport("claude-sonnet-4-20250514"), false);
});

test("assertStrictToolModelSupport accepts Claude Opus 4.7", () => {
  assert.equal(assertStrictToolModelSupport("claude-opus-4-7"), true);
});
