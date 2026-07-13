import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(
  import.meta.dirname,
  "../../../.github/workflows/publish-release-changelog.yml",
);

test("historical backfills run the current changelog generator", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(
    workflow,
    /node workflow\/infra\/scripts\/release\/generate-daily-changelog\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /node repo\/infra\/scripts\/release\/generate-daily-changelog\.mjs/,
  );
});
