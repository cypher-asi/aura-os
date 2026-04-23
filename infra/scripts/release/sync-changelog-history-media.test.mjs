import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildHistoryAssetRef,
  isPublishedMedia,
  isSameReleaseDoc,
  runSync,
  syncHistoryMediaFromLatest,
} from "./sync-changelog-history-media.mjs";

function writeFixtureChannel(rootDir) {
  const channelDir = path.join(rootDir, "changelog", "nightly");
  const historyDir = path.join(channelDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });

  const latestDoc = {
    channel: "nightly",
    date: "2026-04-22",
    version: "0.1.0-nightly.348.1",
    rendered: {
      entries: [
        {
          title: "Debug app rebuilt around project-first nav and a sidekick inspector",
          media: {
            slotId: "entry-debug",
            alt: "Debug screenshot",
            status: "published",
            assetPath: "assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png",
            updatedAt: "2026-04-23T05:11:35.950Z",
            screenshotSource: "openai-polish",
          },
        },
        {
          title: "Skipped entry",
          media: {
            slotId: "entry-skipped",
            alt: "Skipped screenshot",
            status: "skipped",
          },
        },
      ],
    },
  };

  const historyDoc = {
    channel: "nightly",
    date: "2026-04-22",
    version: "0.1.0-nightly.348.1",
    rendered: {
      entries: [
        {
          title: "Debug app rebuilt around project-first nav and a sidekick inspector",
          media: {
            slotId: "entry-debug",
            alt: "Debug screenshot",
            status: "pending",
          },
        },
        {
          title: "Skipped entry",
          media: {
            slotId: "entry-skipped",
            alt: "Skipped screenshot",
            status: "pending",
          },
        },
      ],
    },
  };

  const latestMarkdown = [
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-debug\",\"alt\":\"Debug screenshot\",\"status\":\"published\",\"assetPath\":\"assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png\"} -->",
    "![Debug screenshot](../../assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png)",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-debug -->",
    "",
  ].join("\n");

  const historyMarkdown = [
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-debug\",\"alt\":\"Debug screenshot\"} -->",
    "<!-- AURA_CHANGELOG_MEDIA:PENDING -->",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-debug -->",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(channelDir, "latest.json"), `${JSON.stringify(latestDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(channelDir, "latest.md"), latestMarkdown);
  fs.writeFileSync(path.join(historyDir, "2026-04-22.json"), `${JSON.stringify(historyDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(historyDir, "2026-04-22.md"), historyMarkdown);
}

test("syncHistoryMediaFromLatest mirrors published media into the dated history entry", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-history-sync-"));
  writeFixtureChannel(pagesDir);

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  const historyDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.json"), "utf8"));
  const historyMarkdownPath = path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.md");
  const historyMarkdown = fs.readFileSync(historyMarkdownPath, "utf8");

  const result = syncHistoryMediaFromLatest({
    latestDoc,
    historyDoc,
    historyMarkdown,
    historyMarkdownPath,
    pagesDir,
  });

  assert.equal(result.updatedSlots, 1);
  assert.equal(result.historyDoc.rendered.entries[0].media.status, "published");
  assert.equal(result.historyDoc.rendered.entries[0].media.assetPath, "assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png");
  assert.match(result.historyMarkdown, /!\[Debug screenshot\]\(\.\.\/\.\.\/\.\.\/assets\/changelog\/nightly\/0\.1\.0-nightly\.348\.1\/entry-debug\.png\)/);
});

test("runSync updates matching latest/history pairs and leaves mismatched releases alone", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-history-sync-run-"));
  writeFixtureChannel(pagesDir);

  const stableDir = path.join(pagesDir, "changelog", "stable");
  const stableHistoryDir = path.join(stableDir, "history");
  fs.mkdirSync(stableHistoryDir, { recursive: true });
  fs.writeFileSync(path.join(stableDir, "latest.json"), `${JSON.stringify({
    channel: "stable",
    date: "2026-04-22",
    version: "1.0.0",
    rendered: { entries: [] },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stableDir, "latest.md"), "");
  fs.writeFileSync(path.join(stableHistoryDir, "2026-04-22.json"), `${JSON.stringify({
    channel: "stable",
    date: "2026-04-22",
    version: "0.9.9",
    rendered: { entries: [] },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stableHistoryDir, "2026-04-22.md"), "");

  const summary = runSync({ pagesDir, channel: "" });
  assert.equal(summary.updatedChannels, 1);
  assert.equal(summary.updatedSlots, 1);

  const historyDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.json"), "utf8"));
  assert.equal(historyDoc.rendered.entries[0].media.status, "published");
  assert.equal(summary.results.find((result) => result.channel === "stable")?.updatedSlots ?? 0, 0);
});

test("helpers reflect the same release semantics the workflow relies on", () => {
  assert.equal(isPublishedMedia({ status: "published", assetPath: "assets/demo.png" }), true);
  assert.equal(isPublishedMedia({ status: "pending", assetPath: "assets/demo.png" }), false);
  assert.equal(
    isSameReleaseDoc(
      { channel: "nightly", date: "2026-04-22", version: "0.1.0" },
      { channel: "nightly", date: "2026-04-22", version: "0.1.0" },
    ),
    true,
  );
  assert.equal(
    buildHistoryAssetRef(
      path.join("/tmp/pages", "changelog", "nightly", "history", "2026-04-22.md"),
      "/tmp/pages",
      "assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png",
    ),
    "../../../assets/changelog/nightly/0.1.0-nightly.348.1/entry-debug.png",
  );
});
