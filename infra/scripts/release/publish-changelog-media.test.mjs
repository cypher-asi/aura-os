import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntryPrompt,
  parseArgs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
} from "./publish-changelog-media.mjs";

test("buildEntryPrompt turns a changelog entry into a capture brief", () => {
  const prompt = buildEntryPrompt({
    title: "Feedback board and comments stay visible",
    summary: "The feedback board now keeps discussion visible while triaging ideas.",
    items: [
      { text: "Comments remain visible next to the board." },
      { text: "Reviewers can keep context while triaging." },
    ],
  });

  assert.match(prompt, /Feedback board and comments stay visible/);
  assert.match(prompt, /Key details:/);
  assert.match(prompt, /leave the clearest proof visible/);
});

test("selectBestScreenshot prefers repair, then capture-proof, then validate-proof", () => {
  assert.deepEqual(
    selectBestScreenshot({
      repair: {
        success: true,
        screenshot: { path: "/tmp/repaired.png" },
      },
      phases: [
        { id: "capture-proof", success: true, screenshot: { path: "/tmp/capture.png" } },
      ],
    }),
    {
      path: "/tmp/repaired.png",
      source: "repair",
    },
  );

  assert.deepEqual(
    selectBestScreenshot({
      repair: {
        success: false,
      },
      phases: [
        { id: "validate-proof", success: true, screenshot: { path: "/tmp/validate.png" } },
        { id: "capture-proof", success: true, screenshot: { path: "/tmp/capture.png" } },
      ],
    }),
    {
      path: "/tmp/capture.png",
      source: "capture-proof",
    },
  );
});

test("replaceChangelogMediaBlock swaps the placeholder body while preserving the slot", () => {
  const markdown = [
    "## 9:10 AM — Feedback board and comments stay visible",
    "",
    "A focused pass on collaboration.",
    "",
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-1-feedback-board\",\"batchId\":\"entry-1\",\"slug\":\"feedback-board\",\"alt\":\"Feedback board screenshot\"} -->",
    "<!-- AURA_CHANGELOG_MEDIA:PENDING -->",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-1-feedback-board -->",
    "",
    "- Feedback comments remain visible inline.",
  ].join("\n");

  const updated = replaceChangelogMediaBlock(
    markdown,
    {
      slotId: "entry-1-feedback-board",
      batchId: "entry-1",
      slug: "feedback-board",
      alt: "Feedback board screenshot",
      status: "published",
      assetPath: "assets/changelog/nightly/demo/entry-1-feedback-board.png",
    },
    ["![Feedback board screenshot](../../assets/changelog/nightly/demo/entry-1-feedback-board.png)"],
  );

  assert.match(updated, /"status":"published"/);
  assert.match(updated, /!\[Feedback board screenshot\]/);
  assert.match(updated, /AURA_CHANGELOG_MEDIA:END entry-1-feedback-board/);
});

test("resolveAssetPath nests changelog media by channel and version/date", () => {
  assert.equal(
    resolveAssetPath({
      channel: "nightly",
      version: "0.1.0-nightly.321.1",
      date: "2026-04-21",
      slotId: "entry-1-feedback-board",
      sourcePath: "/tmp/proof.png",
    }),
    "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png",
  );

  assert.equal(
    resolveAssetPath({
      channel: "stable",
      version: "",
      date: "2026-04-22",
      slotId: "entry-2-agents",
      sourcePath: "/tmp/proof.jpeg",
    }),
    "assets/changelog/stable/2026-04-22/entry-2-agents.jpeg",
  );
});

test("parseArgs preserves explicit empty-string values instead of coercing them to booleans", () => {
  assert.deepEqual(
    parseArgs(["--preview-url", "", "--channel", "nightly"]),
    {
      "preview-url": "",
      channel: "nightly",
    },
  );
});
