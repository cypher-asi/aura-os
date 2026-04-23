import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowLocalFallbackOnBrowserbaseQuota,
  buildEntryPrompt,
  buildRetryPlan,
  buildRunSummary,
  buildRunSummaryMarkdown,
  evaluateWorkflowOutcome,
  isBrowserbaseConcurrencyError,
  isBrowserbaseQuotaError,
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

test("Browserbase error classifiers distinguish concurrency from quota exhaustion", () => {
  assert.equal(
    isBrowserbaseConcurrencyError("RateLimitError: max concurrent sessions limit reached (status: 429)"),
    true,
  );
  assert.equal(
    isBrowserbaseQuotaError("APIError: 402 Free plan browser minutes limit reached. Please upgrade your account"),
    true,
  );
  assert.equal(
    isBrowserbaseQuotaError("APIError: status: 429 max concurrent sessions limit reached"),
    false,
  );
});

test("Browserbase local fallback is enabled by default and can be disabled explicitly", () => {
  const previous = process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK;

  delete process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK;
  assert.equal(allowLocalFallbackOnBrowserbaseQuota(), true);

  process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK = "false";
  assert.equal(allowLocalFallbackOnBrowserbaseQuota(), false);

  process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK = "1";
  assert.equal(allowLocalFallbackOnBrowserbaseQuota(), true);

  if (previous === undefined) {
    delete process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK;
  } else {
    process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK = previous;
  }
});

test("buildRunSummary and markdown include operator-facing diagnostics", () => {
  const summary = buildRunSummary([
    {
      slotId: "entry-1-feedback",
      title: "Feedback board",
      status: "published",
      assetPath: "assets/changelog/nightly/demo/entry-1-feedback.png",
      inspectorUrl: "https://browserbase.example/session/123",
    },
    {
      slotId: "entry-2-agents",
      title: "Permissions tab",
      status: "failed",
      error: "Screenshot capture did not produce a passing summary for entry-2-agents",
      sessionId: "bb-session-1",
    },
  ], {
    channel: "nightly",
    version: "0.1.0-nightly.999.1",
    date: "2026-04-22",
    provider: "browserbase",
    profile: "agent-shell-explorer",
    previewUrl: "https://aura-app-72ms.onrender.com/",
    abortRemainingReason: "Skipping remaining media captures after provider exhaustion.",
  });

  assert.equal(summary.previewHost, "aura-app-72ms.onrender.com");
  assert.equal(summary.published, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.workflowOutcome, "partial");
  assert.equal(summary.shouldFailWorkflow, false);
  assert.equal(summary.strictRubricPassed, false);
  assert.deepEqual(summary.failedSlotIds, ["entry-2-agents"]);

  const markdown = buildRunSummaryMarkdown(summary);
  assert.match(markdown, /Changelog Media Diagnostics/);
  assert.match(markdown, /Preview host: aura-app-72ms\.onrender\.com/);
  assert.match(markdown, /Workflow outcome: partial/);
  assert.match(markdown, /Workflow should fail: no/);
  assert.match(markdown, /Strict rubric passed: no/);
  assert.match(markdown, /entry-2-agents/);
  assert.match(markdown, /Skipping remaining media captures after provider exhaustion/);

  const retryPlan = buildRetryPlan(summary);
  assert.equal(retryPlan.failed, 1);
  assert.equal(retryPlan.workflowOutcome, "partial");
  assert.equal(retryPlan.shouldFailWorkflow, false);
  assert.equal(retryPlan.strictRubricPassed, false);
  assert.deepEqual(retryPlan.failedSlots.map((slot) => slot.slotId), ["entry-2-agents"]);
});

test("evaluateWorkflowOutcome only fails when every attempted publish failed", () => {
  assert.deepEqual(
    evaluateWorkflowOutcome({ published: 2, failed: 0 }),
    {
      workflowOutcome: "success",
      shouldFailWorkflow: false,
    },
  );

  assert.deepEqual(
    evaluateWorkflowOutcome({ published: 2, failed: 1 }),
    {
      workflowOutcome: "partial",
      shouldFailWorkflow: false,
    },
  );

  assert.deepEqual(
    evaluateWorkflowOutcome({ published: 0, failed: 3 }),
    {
      workflowOutcome: "failure",
      shouldFailWorkflow: true,
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
