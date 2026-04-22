import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import test from "node:test";

import { loadDemoScreenshotChangelog } from "./demo-screenshot-changelog.mjs";

test("loadDemoScreenshotChangelog parses markdown changelog structure", async () => {
  const changelog = await loadDemoScreenshotChangelog({
    changelog: path.resolve(
      new URL("../../../infra/scripts/release/fixtures/changelog-good-candidate.json", import.meta.url).pathname,
    ),
  });

  assert.equal(changelog.format, "json");
  assert.equal(changelog.document.rendered.highlights.length > 0, true);
  assert.equal(Array.isArray(changelog.document.top_areas), true);
});

test("loadDemoScreenshotChangelog parses published-style markdown", async () => {
  const markdown = [
    "# Feedback board lands with visible comments",
    "",
    "- Date: `2026-04-21`",
    "- Channel: `nightly`",
    "- Version: `0.1.0-nightly.321.1`",
    "",
    "A short nightly focused on discussion quality and approvals.",
    "",
    "## 9:29 PM — Feedback board and discussion thread",
    "",
    "A focused pass on collaboration.",
    "",
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-1-feedback\",\"batchId\":\"entry-1\"} -->",
    "<!-- AURA_CHANGELOG_MEDIA:PENDING -->",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-1-feedback -->",
    "",
    "![Feedback board screenshot](../../assets/changelog/nightly/demo/entry-1-feedback.png)",
    "",
    "- Feedback comments are now visible inline.",
    "- Reviewers can approve ideas faster.",
    "",
    "## Highlights",
    "",
    "- Feedback comments are now visible inline",
    "- Reviewers can approve ideas faster",
  ].join("\n");

  const tempPath = path.join(process.cwd(), "output", "demo-screenshots", `markdown-test-${Date.now()}.md`);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.writeFile(tempPath, markdown, "utf8");

  const changelog = await loadDemoScreenshotChangelog({
    changelog: tempPath,
  });

  assert.equal(changelog.format, "markdown");
  assert.equal(changelog.document.rendered.title, "Feedback board lands with visible comments");
  assert.equal(changelog.document.rendered.highlights.length, 2);
});
