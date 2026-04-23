import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowLocalFallbackOnBrowserbaseQuota,
  buildEntryPrompt,
  buildRetryCorrectionGuidance,
  buildRetryPlan,
  buildRunSummary,
  buildRunSummaryMarkdown,
  classifyMediaFailure,
  evaluateWorkflowOutcome,
  isBrowserbaseConcurrencyError,
  isBrowserbaseQuotaError,
  mergePublishedMedia,
  parseArgs,
  resolveTargetChangelogDocs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
  shouldPublishEntryMedia,
} from "./publish-changelog-media.mjs";

const scriptPath = path.join(import.meta.dirname, "publish-changelog-media.mjs");

function writeFixtureChangelog({ pagesDir, version = "0.1.0-nightly.fixture.1" } = {}) {
  const channelDir = path.join(pagesDir, "changelog", "nightly");
  const historyDir = path.join(channelDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });

  const doc = {
    schemaVersion: 1,
    channel: "nightly",
    version,
    date: "2026-04-22",
    rawCommits: [
      { sha: "abc1234", files: ["interface/src/apps/feedback/FeedbackMainPanel.tsx"] },
      { sha: "def5678", files: ["interface/src/apps/agents/AgentCreateModal.tsx"] },
    ],
    rendered: {
      title: "Fixture changelog",
      intro: "Fixture intro.",
      highlights: [],
      entries: [
        {
          batch_id: "entry-1",
          time_label: "9:10 AM",
          title: "Feedback board and comments stay visible",
          summary: "The feedback board now keeps discussion visible while triaging ideas.",
          items: [{ text: "Comments remain visible.", commit_shas: ["abc1234"] }],
          media: {
            requested: true,
            status: "pending",
            slotId: "entry-1-feedback-board",
            slug: "feedback-board",
            alt: "Feedback board screenshot",
          },
        },
        {
          batch_id: "entry-2",
          time_label: "10:20 AM",
          title: "Agent creation screen exposes model choice",
          summary: "The agent creation screen makes the model selection visible.",
          items: [{ text: "Model choices are visible.", commit_shas: ["def5678"] }],
          media: {
            requested: true,
            status: "pending",
            slotId: "entry-2-agent-create",
            slug: "agent-create",
            alt: "Agent creation screenshot",
          },
        },
      ],
    },
  };

  const markdown = [
    "# Fixture changelog",
    "",
    "## 9:10 AM — Feedback board and comments stay visible",
    "",
    "The feedback board now keeps discussion visible while triaging ideas.",
    "",
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-1-feedback-board\",\"batchId\":\"entry-1\",\"slug\":\"feedback-board\",\"alt\":\"Feedback board screenshot\"} -->",
    "<!-- AURA_CHANGELOG_MEDIA:PENDING -->",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-1-feedback-board -->",
    "",
    "- Comments remain visible. (`abc1234`)",
    "",
    "## 10:20 AM — Agent creation screen exposes model choice",
    "",
    "The agent creation screen makes the model selection visible.",
    "",
    "<!-- AURA_CHANGELOG_MEDIA:BEGIN {\"slotId\":\"entry-2-agent-create\",\"batchId\":\"entry-2\",\"slug\":\"agent-create\",\"alt\":\"Agent creation screenshot\"} -->",
    "<!-- AURA_CHANGELOG_MEDIA:PENDING -->",
    "<!-- AURA_CHANGELOG_MEDIA:END entry-2-agent-create -->",
    "",
    "- Model choices are visible. (`def5678`)",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(channelDir, "latest.json"), `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(path.join(channelDir, "latest.md"), markdown);
  fs.writeFileSync(path.join(historyDir, "2026-04-22.json"), `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(path.join(historyDir, "2026-04-22.md"), markdown);
}

function runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath, version = "0.1.0-nightly.fixture.1" }) {
  return spawnSync(process.execPath, [
    scriptPath,
    "--repo-dir",
    repoDir,
    "--pages-dir",
    pagesDir,
    "--channel",
    "nightly",
    "--version",
    version,
    "--preview-url",
    "https://example.test",
    "--provider",
    "browserbase",
    "--fixture-results-file",
    fixtureResultsPath,
  ], {
    encoding: "utf8",
  });
}

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

test("buildEntryPrompt adds targeted retry guidance for failed media slots", () => {
  const prompt = buildEntryPrompt({
    title: "Agent creation screen exposes model choice",
    summary: "The agent creation screen makes the model selection visible.",
    items: [{ text: "Model choices are visible." }],
    media: {
      status: "failed",
      failureClass: "quality_gate",
      error: "Screenshot capture did not produce a passing summary for entry-2-agent-create",
    },
  });

  assert.match(prompt, /Retry correction pass:/);
  assert.match(prompt, /Previous failure class: quality_gate/);
  assert.match(prompt, /failed the quality gate/);
  assert.match(prompt, /select a concrete row\/tab\/item/);
});

test("buildRetryCorrectionGuidance maps navigation failures to a shorter correction path", () => {
  const guidance = buildRetryCorrectionGuidance({
    status: "failed",
    failureClass: "navigation_or_timeout",
    error: "locator timed out while opening panel",
  });

  assert.match(guidance, /Previous failure class: navigation_or_timeout/);
  assert.match(guidance, /shortest visible path/);
  assert.match(guidance, /Avoid deep exploration/);
});

test("mergePublishedMedia clears stale retry failure metadata", () => {
  assert.deepEqual(
    mergePublishedMedia(
      {
        requested: true,
        status: "failed",
        error: "old failure",
        failureClass: "quality_gate",
        retryInstruction: "retry harder",
      },
      {
        status: "published",
        assetPath: "assets/changelog/nightly/demo/proof.png",
        updatedAt: "2026-04-22T00:00:00.000Z",
      },
    ),
    {
      requested: true,
      status: "published",
      assetPath: "assets/changelog/nightly/demo/proof.png",
      updatedAt: "2026-04-22T00:00:00.000Z",
    },
  );
});

test("selectBestScreenshot prefers repair, then capture-proof, then validate-proof", () => {
  assert.deepEqual(
    selectBestScreenshot({
      repair: {
        success: true,
        quality: { ok: true },
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
        success: true,
        quality: { ok: false },
        screenshot: { path: "/tmp/repaired.png" },
      },
      phases: [
        { id: "capture-proof", success: true, screenshot: { path: "/tmp/capture.png" } },
      ],
    }),
    {
      path: "/tmp/capture.png",
      source: "capture-proof",
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

test("classifyMediaFailure turns capture errors into retry-actionable classes", () => {
  assert.equal(
    classifyMediaFailure(new Error("Screenshot capture did not produce a passing summary for entry-feedback")),
    "quality_gate",
  );
  assert.equal(
    classifyMediaFailure(new Error("RateLimitError: max concurrent sessions limit reached (status: 429)")),
    "browserbase_concurrency",
  );
  assert.equal(
    classifyMediaFailure(new Error("APIError: 402 Free plan browser minutes limit reached. Please upgrade your account")),
    "browserbase_quota",
  );
  assert.equal(
    classifyMediaFailure(new Error("No publishable screenshot was produced for entry-feedback")),
    "missing_capture_output",
  );
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
      failureClass: "quality_gate",
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
  assert.match(markdown, /class: quality_gate/);
  assert.match(markdown, /entry-2-agents/);
  assert.match(markdown, /Skipping remaining media captures after provider exhaustion/);

  const retryPlan = buildRetryPlan(summary);
  assert.equal(retryPlan.failed, 1);
  assert.equal(retryPlan.workflowOutcome, "partial");
  assert.equal(retryPlan.shouldFailWorkflow, false);
  assert.equal(retryPlan.strictRubricPassed, false);
  assert.equal(retryPlan.failedSlots[0].failureClass, "quality_gate");
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

test("resolveTargetChangelogDocs validates date and version when both are supplied", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-pages-date-version-"));
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

  const resolved = resolveTargetChangelogDocs(channelDir, "2026-04-21", "0.1.0-nightly.324.1");
  assert.equal(resolved.target.version, "0.1.0-nightly.324.1");
  assert.equal(resolved.target.date, "2026-04-21");

  assert.throws(
    () => resolveTargetChangelogDocs(channelDir, "2026-04-22", "0.1.0-nightly.324.1"),
    /does not match requested date 2026-04-22/,
  );
});

test("publish script fixture mode keeps partial media success green and writes retry diagnostics", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  fs.writeFileSync(screenshotPath, "fake png");
  const fixtureResultsPath = path.join(rootDir, "fixture-results.json");
  fs.writeFileSync(fixtureResultsPath, `${JSON.stringify({
    "entry-1-feedback-board": {
      ok: true,
      storyTitle: "Feedback board proof",
      phases: [
        {
          id: "capture-proof",
          success: true,
          screenshot: { path: screenshotPath },
        },
      ],
      screenshots: [{ path: screenshotPath }],
      inspectorUrl: "https://browserbase.example/session/success",
      sessionId: "fixture-success",
      outputDir: path.join(rootDir, "capture-success"),
    },
    "entry-2-agent-create": {
      ok: false,
      inspectorUrl: "https://browserbase.example/session/failure",
      sessionId: "fixture-failure",
      outputDir: path.join(rootDir, "capture-failure"),
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const summaryPath = path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.workflowOutcome, "partial");
  assert.equal(summary.shouldFailWorkflow, false);
  assert.equal(summary.published, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.publishedSlotIds, ["entry-1-feedback-board"]);
  assert.deepEqual(summary.failedSlotIds, ["entry-2-agent-create"]);

  const retryPlan = JSON.parse(fs.readFileSync(path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-retry.json"), "utf8"));
  assert.equal(retryPlan.failed, 1);
  assert.equal(retryPlan.failedSlots[0].slotId, "entry-2-agent-create");
  assert.equal(retryPlan.failedSlots[0].failureClass, "quality_gate");

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.status, "published");
  assert.equal("failureClass" in latestDoc.rendered.entries[0].media, false);
  assert.equal(latestDoc.rendered.entries[1].media.status, "failed");
  assert.equal(latestDoc.rendered.entries[1].media.failureClass, "quality_gate");
  assert.match(latestDoc.rendered.entries[1].media.retryInstruction, /Retry correction pass:/);
  assert.equal(fs.existsSync(path.join(pagesDir, latestDoc.rendered.entries[0].media.assetPath)), true);
  assert.match(
    fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.md"), "utf8"),
    /!\[Feedback board screenshot\]\(\.\.\/\.\.\/assets\/changelog\/nightly\/0\.1\.0-nightly\.fixture\.1\/entry-1-feedback-board\.png\)/,
  );
});

test("publish script fixture mode fails when every attempted media slot fails", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-fail-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const fixtureResultsPath = path.join(rootDir, "fixture-results.json");
  fs.writeFileSync(fixtureResultsPath, `${JSON.stringify({
    "entry-1-feedback-board": {
      ok: false,
      inspectorUrl: "https://browserbase.example/session/failure-1",
      sessionId: "fixture-failure-1",
    },
    "entry-2-agent-create": {
      ok: false,
      inspectorUrl: "https://browserbase.example/session/failure-2",
      sessionId: "fixture-failure-2",
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 1, result.stderr || result.stdout);

  const summaryPath = path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.workflowOutcome, "failure");
  assert.equal(summary.shouldFailWorkflow, true);
  assert.equal(summary.published, 0);
  assert.equal(summary.failed, 2);
});
