import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishChangelogMedia } from "./publish-changelog-media.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writePngPlaceholder(filePath, body = "png") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function changelogDoc() {
  return {
    schemaVersion: 1,
    channel: "nightly",
    date: "2026-04-24",
    rendered: {
      entries: [
        {
          batch_id: "entry-model-picker",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 directly from the chat model picker.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123"],
            },
          ],
        },
      ],
    },
  };
}

test("publishChangelogMedia copies publish-ready assets and updates latest/history JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-publish-media-"));
  const pagesDir = path.join(tempDir, "pages");
  const sourcePng = path.join(tempDir, "out", "branded.png");
  writePngPlaceholder(sourcePng, "image-v1");
  writeJson(path.join(pagesDir, "changelog", "nightly", "latest.json"), changelogDoc());
  writeJson(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-24.json"), changelogDoc());
  const manifestPath = path.join(tempDir, "manifest.json");
  writeJson(manifestPath, {
    schemaVersion: 1,
    assets: [
      {
        entryId: "entry-model-picker",
        title: "GPT-5.5 available in the chat model picker",
        publicCaption: "GPT-5.5 is now available in the chat model picker.",
        source: { brandedPngPath: sourcePng },
        dimensions: { width: 3120, height: 1755 },
        bytes: 8,
        gates: { brandedVision: "accepted" },
      },
    ],
  });

  const report = publishChangelogMedia({
    manifestFile: manifestPath,
    pagesDir,
    channel: "nightly",
    date: "2026-04-24",
    generatedAt: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(report.publishedCount, 1);
  const latest = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  const history = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-24.json"), "utf8"));
  const media = latest.rendered.entries[0].media;
  assert.equal(media.status, "published");
  assert.equal(media.type, "image");
  assert.equal(media.sourceCommitShas[0], "abc123");
  assert.ok(media.assetPath.startsWith("assets/changelog/nightly/2026-04-24/entry-model-picker-"));
  assert.equal(fs.existsSync(path.join(pagesDir, media.assetPath)), true);
  assert.deepEqual(history.rendered.entries[0].media, media);
});

test("publishChangelogMedia skips already-published media unless refresh-existing is set", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-publish-media-"));
  const pagesDir = path.join(tempDir, "pages");
  const sourcePng = path.join(tempDir, "out", "branded.png");
  writePngPlaceholder(sourcePng, "image-v2");
  const doc = changelogDoc();
  doc.rendered.entries[0].media = {
    status: "published",
    assetPath: "assets/changelog/nightly/2026-04-24/existing.png",
  };
  writeJson(path.join(pagesDir, "changelog", "nightly", "latest.json"), doc);
  writeJson(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-24.json"), doc);
  const manifestPath = path.join(tempDir, "manifest.json");
  writeJson(manifestPath, {
    assets: [
      {
        entryId: "entry-model-picker",
        source: { brandedPngPath: sourcePng },
        dimensions: { width: 3120, height: 1755 },
      },
    ],
  });

  const first = publishChangelogMedia({
    manifestFile: manifestPath,
    pagesDir,
    channel: "nightly",
    date: "2026-04-24",
  });
  assert.equal(first.publishedCount, 0);
  assert.equal(first.skippedExistingCount, 1);

  const second = publishChangelogMedia({
    manifestFile: manifestPath,
    pagesDir,
    channel: "nightly",
    date: "2026-04-24",
    refreshExisting: true,
  });
  assert.equal(second.publishedCount, 1);
  const latest = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.notEqual(latest.rendered.entries[0].media.assetPath, "assets/changelog/nightly/2026-04-24/existing.png");
});

test("publishChangelogMedia backfills historical dates without mutating latest", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-publish-media-"));
  const pagesDir = path.join(tempDir, "pages");
  const sourcePng = path.join(tempDir, "out", "historical.png");
  writePngPlaceholder(sourcePng, "image-v3");
  const latest = changelogDoc();
  latest.date = "2026-04-25";
  latest.rendered.entries[0].batch_id = "latest-entry";
  latest.rendered.entries[0].title = "Latest unrelated entry";
  const history = changelogDoc();
  history.date = "2026-04-24";
  writeJson(path.join(pagesDir, "changelog", "nightly", "latest.json"), latest);
  writeJson(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-24.json"), history);
  const manifestPath = path.join(tempDir, "manifest.json");
  writeJson(manifestPath, {
    assets: [
      {
        entryId: "entry-model-picker",
        title: "GPT-5.5 available in the chat model picker",
        publicCaption: "GPT-5.5 is now available in the chat model picker.",
        source: { brandedPngPath: sourcePng },
        dimensions: { width: 2560, height: 1440 },
        bytes: 8,
      },
    ],
  });

  const report = publishChangelogMedia({
    manifestFile: manifestPath,
    pagesDir,
    channel: "nightly",
    date: "2026-04-24",
    generatedAt: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(report.publishedCount, 1);
  assert.equal(report.results[0].latestStatus, "latest-unchanged");
  assert.equal(report.results[0].historyStatus, "published");
  const nextLatest = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  const nextHistory = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-24.json"), "utf8"));
  assert.equal(nextLatest.rendered.entries[0].media, undefined);
  assert.equal(nextHistory.rendered.entries[0].media.status, "published");
  assert.ok(nextHistory.rendered.entries[0].media.assetPath.includes("2026-04-24/entry-model-picker-"));
});
