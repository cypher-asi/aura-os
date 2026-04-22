import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildEntryPrompt,
  parseArgs,
  resolveTargetChangelogDocs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
  shouldPublishEntryMedia,
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

test("shouldPublishEntryMedia skips healthy published assets by default", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-pages-"));
  const assetPath = "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png";
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  fs.mkdirSync(path.dirname(absoluteAssetPath), { recursive: true });
  fs.writeFileSync(absoluteAssetPath, "ok");

  assert.deepEqual(
    shouldPublishEntryMedia(
      {
        media: {
          requested: true,
          status: "published",
          assetPath,
        },
      },
      pagesDir,
      {},
    ),
    {
      publish: false,
      reason: "published media asset already exists",
    },
  );

  assert.deepEqual(
    shouldPublishEntryMedia(
      {
        media: {
          requested: true,
          status: "failed",
          assetPath,
        },
      },
      pagesDir,
      {},
    ),
    {
      publish: true,
      reason: "media status is failed",
    },
  );
});

test("resolveTargetChangelogDocs can target a historical changelog by version", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-pages-"));
  const channelDir = path.join(pagesDir, "changelog", "nightly");
  const historyDir = path.join(channelDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });

  const latestDoc = {
    channel: "nightly",
    date: "2026-04-22",
    version: "0.1.0-nightly.325.1",
  };
  const historyDoc = {
    channel: "nightly",
    date: "2026-04-21",
    version: "0.1.0-nightly.324.1",
  };

  fs.writeFileSync(path.join(channelDir, "latest.json"), `${JSON.stringify(latestDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(channelDir, "latest.md"), "# latest\n");
  fs.writeFileSync(path.join(historyDir, "2026-04-21.json"), `${JSON.stringify(historyDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(historyDir, "2026-04-21.md"), "# history\n");

  const resolved = resolveTargetChangelogDocs(channelDir, "", "0.1.0-nightly.324.1");
  assert.equal(resolved.target.version, "0.1.0-nightly.324.1");
  assert.equal(resolved.target.date, "2026-04-21");
  assert.equal(resolved.target.isLatest, false);
  assert.match(resolved.target.jsonPath, /2026-04-21\.json$/);
});
