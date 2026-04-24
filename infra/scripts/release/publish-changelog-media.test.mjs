import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowLocalFallbackOnBrowserbaseQuota,
  assertSelectedScreenshotReadableEnough,
  buildEntryPrompt,
  composeBrandedScreenshotCard,
  buildRetryCorrectionGuidance,
  buildRetryPlan,
  buildRunSummary,
  buildRunSummaryMarkdown,
  classifyMediaFailure,
  evaluateWorkflowOutcome,
  isBrowserbaseConcurrencyError,
  isBrowserbaseQuotaError,
  mergeFailedMedia,
  mergePublishedMedia,
  normalizeOpenAIJudgeScore,
  parseArgs,
  requestOpenAIBackground,
  resolveTargetChangelogDocs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
  shouldPublishEntryMedia,
} from "./publish-changelog-media.mjs";

const scriptPath = path.join(import.meta.dirname, "publish-changelog-media.mjs");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

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

function writeSolidPng(filePath, width, height, rgba) {
  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      image.data[index] = rgba[0];
      image.data[index + 1] = rgba[1];
      image.data[index + 2] = rgba[2];
      image.data[index + 3] = rgba[3];
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(image));
}

function findColorBounds(image, predicate) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = ((y * image.width) + x) * 4;
      const rgba = [
        image.data[index],
        image.data[index + 1],
        image.data[index + 2],
        image.data[index + 3],
      ];
      if (!predicate(rgba)) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  };
}

test("buildEntryPrompt turns a changelog entry into a capture brief", () => {
  const prompt = buildEntryPrompt({
    title: "Feedback board and comments stay visible",
    summary: "The feedback board now keeps discussion visible while triaging ideas.",
    items: [
      { text: "Comments remain visible next to the board." },
      { text: "Reviewers can keep context while triaging." },
    ],
    media: {
      proofSurface: "Feedback board thread view",
      captureHint: "Open a feedback thread and keep the comments column visible.",
      visibleProof: ["Feedback", "Comments"],
      presentationMode: "branded_card",
    },
  });

  assert.match(prompt, /Feedback board and comments stay visible/);
  assert.match(prompt, /Key details:/);
  assert.match(prompt, /Expected proof surface: Feedback board thread view/);
  assert.match(prompt, /Visible proof to keep on screen: Feedback; Comments/);
  assert.match(prompt, /Capture guidance: Open a feedback thread and keep the comments column visible\./);
  assert.match(prompt, /leave the clearest proof visible/);
  assert.match(prompt, /Never publish a screenshot that still says 'Your generated image will appear here'/);
});

test("buildEntryPrompt uses contextual proof guidance for micro-ui entries", () => {
  const prompt = buildEntryPrompt({
    title: "GPT-5.5 in the model picker",
    summary: "The chat composer now includes GPT-5.5 in the model dropdown.",
    items: [{ text: "Open the model picker and keep GPT-5.5 visible." }],
    media: {
      presentationMode: "raw_contextual",
      proofSurface: "Chat model picker",
      captureHint: "Keep the composer and picker visible in one frame.",
      visibleProof: ["GPT-5.5", "Model picker"],
    },
  });

  assert.match(prompt, /Capture mode: raw contextual proof screenshot\./);
  assert.match(prompt, /zoom the real app UI before capture/i);
  assert.match(prompt, /Avoid menu-only or widget-only crops/);
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

test("mergeFailedMedia clears stale renderable media metadata", () => {
  const failed = mergeFailedMedia(
    {
      requested: true,
      status: "published",
      slotId: "entry-1-aura-3d",
      slug: "aura-3d",
      alt: "AURA 3D screenshot",
      assetPath: "assets/changelog/nightly/old/bad-placeholder.png",
      screenshotSource: "openai-polish",
      originalScreenshotSource: "capture-proof",
      polishProvider: "openai",
      polishModel: "gpt-image-2",
      polishJudgeModel: "gpt-4.1-mini",
      polishScore: 92,
      polishFallbackReason: "",
    },
    {
      status: "failed",
      updatedAt: "2026-04-24T04:30:00.000Z",
      error: "Screenshot capture did not produce a passing summary",
      failureClass: "quality_gate",
      retryInstruction: "Retry correction pass: capture the real proof state.",
    },
  );

  assert.equal(failed.status, "failed");
  assert.equal(failed.requested, true);
  assert.equal(failed.slotId, "entry-1-aura-3d");
  assert.equal(failed.alt, "AURA 3D screenshot");
  assert.equal(failed.failureClass, "quality_gate");
  assert.equal("assetPath" in failed, false);
  assert.equal("screenshotSource" in failed, false);
  assert.equal("originalScreenshotSource" in failed, false);
  assert.equal("polishProvider" in failed, false);
  assert.equal("polishModel" in failed, false);
  assert.equal("polishJudgeModel" in failed, false);
  assert.equal("polishScore" in failed, false);
  assert.equal("polishFallbackReason" in failed, false);
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

test("normalizeOpenAIJudgeScore accepts accidental 0-10 judge scales", () => {
  assert.equal(normalizeOpenAIJudgeScore(8), 80);
  assert.equal(normalizeOpenAIJudgeScore(87), 87);
  assert.equal(normalizeOpenAIJudgeScore(140), 100);
  assert.equal(normalizeOpenAIJudgeScore(""), 0);
});

test("requestOpenAIBackground falls back when the preferred image edit model is unsupported", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-openai-fallback-"));
  const screenshotPath = path.join(rootDir, "screenshot.png");
  writeSolidPng(screenshotPath, 16, 16, [20, 120, 150, 255]);
  const originalFetch = globalThis.fetch;
  const previousModel = process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL;
  const calls = [];
  process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL = "gpt-image-2";
  globalThis.fetch = async (_url, options) => {
    const requestedModel = options.body.get("model");
    calls.push(requestedModel);
    if (requestedModel === "gpt-image-2") {
      return new Response(JSON.stringify({ error: { message: "Unsupported model: gpt-image-2" } }), { status: 400 });
    }
    return new Response(JSON.stringify({
      model: requestedModel,
      data: [{ b64_json: Buffer.from("png").toString("base64") }],
    }), { status: 200 });
  };

  try {
    const result = await requestOpenAIBackground({
      apiKey: "sk-test",
      screenshotPath,
      prompt: "Create a branded Aura background.",
    });
    assert.deepEqual(calls, ["gpt-image-2", "gpt-image-1.5"]);
    assert.equal(result.model, "gpt-image-1.5");
    assert.equal(result.requestedModel, "gpt-image-1.5");
    assert.equal(result.fallbackErrors.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousModel === undefined) {
      delete process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL;
    } else {
      process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL = previousModel;
    }
  }
});

test("composeBrandedScreenshotCard keeps output as a valid branded PNG", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-card-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 160, 90, [28, 190, 210, 255]);

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
  });

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  assert.equal(output.width, 3840);
  assert.equal(output.height, 2160);
  assert.equal(fs.statSync(outputPath).size > 0, true);
});

test("composeBrandedScreenshotCard preserves screenshot aspect ratio instead of forcing 16:9", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-aspect-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 120, 120, [240, 32, 32, 255]);

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
  });

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  const renderedAspect = redBounds.width / Math.max(1, redBounds.height);
  assert.ok(Math.abs(renderedAspect - 1) < 0.08, `expected near-square screenshot, got aspect ${renderedAspect}`);
});

test("composeBrandedScreenshotCard lets widescreen screenshots dominate the canvas", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-footprint-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 2560, 1440, [240, 32, 32, 255]);

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
  });

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  assert.ok(redBounds.width >= 2500, `expected screenshot footprint to stay wide, got ${redBounds.width}px`);
  assert.ok(redBounds.height >= 1400, `expected screenshot footprint to stay tall enough for dense UI, got ${redBounds.height}px`);
});

test("composeBrandedScreenshotCard safely enlarges the proof image inside the branded card", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-safe-upscale-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 160, 90, [240, 32, 32, 255]);

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
  });

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  assert.ok(redBounds.width > 160, `expected screenshot to grow inside the card, got ${redBounds.width}px`);
  assert.ok(redBounds.height > 90, `expected screenshot to grow inside the card, got ${redBounds.height}px`);
  assert.ok(redBounds.width <= 320, `expected screenshot upscale to stay bounded, got ${redBounds.width}px`);
  assert.ok(redBounds.height <= 180, `expected screenshot upscale to stay bounded, got ${redBounds.height}px`);
});

test("assertSelectedScreenshotReadableEnough rejects source proofs that are too small for readable text", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-readable-source-"));
  const screenshotPath = path.join(rootDir, "tiny-proof.png");
  writeSolidPng(screenshotPath, 180, 120, [240, 32, 32, 255]);

  assert.throws(() => assertSelectedScreenshotReadableEnough({
    repoDir: repoRoot,
    entry: {
      media: {
        requested: true,
        presentationMode: "raw_contextual",
      },
    },
    selectedScreenshot: {
      path: screenshotPath,
      source: "capture-proof",
    },
    summary: {},
  }), /too small for readable changelog media/);
});

test("assertSelectedScreenshotReadableEnough rejects one-x contextual crops before 4K composition", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-one-x-contextual-"));
  const screenshotPath = path.join(rootDir, "model-picker-one-x.png");
  writeSolidPng(screenshotPath, 860, 720, [240, 32, 32, 255]);

  assert.throws(() => assertSelectedScreenshotReadableEnough({
    repoDir: repoRoot,
    entry: {
      media: {
        requested: true,
        presentationMode: "raw_contextual",
      },
    },
    selectedScreenshot: {
      path: screenshotPath,
      source: "capture-proof",
    },
    summary: {},
  }), /too small for readable changelog media/);
});

test("assertSelectedScreenshotReadableEnough rejects tiny contextual content inside a large capture", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-tiny-contextual-content-"));
  const screenshotPath = path.join(rootDir, "tiny-content.png");
  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const screenshot = new PNG({ width: 1600, height: 900 });
  for (let y = 0; y < screenshot.height; y += 1) {
    for (let x = 0; x < screenshot.width; x += 1) {
      const index = ((y * screenshot.width) + x) * 4;
      const insideProof = x >= 1100 && x < 1230 && y >= 360 && y < 500;
      screenshot.data[index] = insideProof ? 240 : 5;
      screenshot.data[index + 1] = insideProof ? 32 : 7;
      screenshot.data[index + 2] = insideProof ? 32 : 10;
      screenshot.data[index + 3] = 255;
    }
  }
  fs.writeFileSync(screenshotPath, PNG.sync.write(screenshot));

  assert.throws(() => assertSelectedScreenshotReadableEnough({
    repoDir: repoRoot,
    entry: {
      media: {
        requested: true,
        presentationMode: "raw_contextual",
      },
    },
    selectedScreenshot: {
      path: screenshotPath,
      source: "capture-proof",
    },
    summary: {},
  }), /Contextual proof content is too small/);
});

test("assertSelectedScreenshotReadableEnough rejects generated-product placeholders before publishing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-empty-placeholder-"));
  const screenshotPath = path.join(rootDir, "placeholder-proof.png");
  writeSolidPng(screenshotPath, 1200, 800, [12, 24, 40, 255]);

  assert.throws(() => assertSelectedScreenshotReadableEnough({
    repoDir: repoRoot,
    entry: {
      media: {
        requested: true,
        presentationMode: "branded_card",
      },
    },
    selectedScreenshot: {
      path: screenshotPath,
      source: "capture-proof",
    },
    summary: {
      phases: [
        {
          id: "capture-proof",
          visibleText: "/test org Search Demo Project Image 3D Model Your generated image will appear here",
        },
      ],
    },
  }), /generated-product placeholder text/);
});

test("assertSelectedScreenshotReadableEnough accepts dense contextual proof crops", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-readable-source-pass-"));
  const screenshotPath = path.join(rootDir, "contextual-proof.png");
  writeSolidPng(screenshotPath, 1400, 800, [240, 32, 32, 255]);

  const report = assertSelectedScreenshotReadableEnough({
    repoDir: repoRoot,
    entry: {
      media: {
        requested: true,
        presentationMode: "raw_contextual",
      },
    },
    selectedScreenshot: {
      path: screenshotPath,
      source: "capture-proof",
    },
    summary: {},
  });

  assert.equal(report.width, 1400);
  assert.equal(report.height, 800);
});

test("composeBrandedScreenshotCard gives contextual proof captures a larger readable footprint", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-contextual-proof-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 1600, 900, [240, 32, 32, 255]);
  const previousUpscale = process.env.AURA_CHANGELOG_MEDIA_MAX_SCREENSHOT_UPSCALE;
  delete process.env.AURA_CHANGELOG_MEDIA_MAX_SCREENSHOT_UPSCALE;

  try {
    composeBrandedScreenshotCard({
      repoDir: repoRoot,
      backgroundPath,
      screenshotPath,
      outputPath,
      presentationMode: "raw_contextual",
    });
  } finally {
    if (previousUpscale === undefined) {
      delete process.env.AURA_CHANGELOG_MEDIA_MAX_SCREENSHOT_UPSCALE;
    } else {
      process.env.AURA_CHANGELOG_MEDIA_MAX_SCREENSHOT_UPSCALE = previousUpscale;
    }
  }

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  assert.ok(redBounds.width >= 3400, `expected contextual proof screenshot to dominate the card, got ${redBounds.width}px`);
  assert.ok(redBounds.height >= 1900, `expected contextual proof screenshot to be tall enough for dense UI, got ${redBounds.height}px`);
});

test("composeBrandedScreenshotCard trims empty margins around contextual micro-ui proof", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-contextual-trim-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const screenshot = new PNG({ width: 1600, height: 900 });
  for (let y = 0; y < screenshot.height; y += 1) {
    for (let x = 0; x < screenshot.width; x += 1) {
      const index = ((y * screenshot.width) + x) * 4;
      const insideProof = x >= 900 && x < 1500 && y >= 250 && y < 650;
      screenshot.data[index] = insideProof ? 240 : 5;
      screenshot.data[index + 1] = insideProof ? 32 : 7;
      screenshot.data[index + 2] = insideProof ? 32 : 10;
      screenshot.data[index + 3] = 255;
    }
  }
  fs.writeFileSync(screenshotPath, PNG.sync.write(screenshot));

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
    presentationMode: "raw_contextual",
  });

  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  assert.ok(redBounds.width >= 650, `expected contextual proof to be zoomed after empty-margin trim, got ${redBounds.width}px`);
  assert.ok(redBounds.height >= 650, `expected contextual proof to be zoomed after empty-margin trim, got ${redBounds.height}px`);
});

test("composeBrandedScreenshotCard keeps a safety inset so product edges are not clipped by the frame", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-padding-"));
  const backgroundPath = path.join(rootDir, "background.png");
  const screenshotPath = path.join(rootDir, "screenshot.png");
  const outputPath = path.join(rootDir, "branded.png");
  writeSolidPng(backgroundPath, 320, 213, [3, 8, 22, 255]);
  writeSolidPng(screenshotPath, 160, 90, [240, 32, 32, 255]);

  composeBrandedScreenshotCard({
    repoDir: repoRoot,
    backgroundPath,
    screenshotPath,
    outputPath,
  });

  const requireFromInterface = createRequire(path.join(repoRoot, "interface", "package.json"));
  const { PNG } = requireFromInterface("pngjs");
  const output = PNG.sync.read(fs.readFileSync(outputPath));
  const redBounds = findColorBounds(output, ([r, g, b, a]) => a > 0 && r >= 220 && g <= 80 && b <= 80);

  assert.ok(redBounds);
  assert.ok(redBounds.minX >= 20, `expected left inset, got ${redBounds.minX}px`);
  assert.ok(redBounds.minY >= 20, `expected top inset, got ${redBounds.minY}px`);
  assert.ok((output.width - 1 - redBounds.maxX) >= 20, `expected right inset, got ${output.width - 1 - redBounds.maxX}px`);
  assert.ok((output.height - 1 - redBounds.maxY) >= 20, `expected bottom inset, got ${output.height - 1 - redBounds.maxY}px`);
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

test("resolveTargetChangelogDocs prefers the dated history mirror for the latest release when it exists", () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-pages-latest-history-"));
  const channelDir = path.join(pagesDir, "changelog", "nightly");
  const historyDir = path.join(channelDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });

  const latestDoc = {
    channel: "nightly",
    date: "2026-04-22",
    version: "0.1.0-nightly.325.1",
  };

  fs.writeFileSync(path.join(channelDir, "latest.json"), `${JSON.stringify(latestDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(channelDir, "latest.md"), "# latest\n");
  fs.writeFileSync(path.join(historyDir, "2026-04-22.json"), `${JSON.stringify(latestDoc, null, 2)}\n`);
  fs.writeFileSync(path.join(historyDir, "2026-04-22.md"), "# history\n");

  const resolved = resolveTargetChangelogDocs(channelDir, "", "0.1.0-nightly.325.1");
  assert.equal(resolved.target.version, "0.1.0-nightly.325.1");
  assert.equal(resolved.target.date, "2026-04-22");
  assert.equal(resolved.target.isLatest, true);
  assert.match(resolved.target.jsonPath, /2026-04-22\.json$/);
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
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
  const polishedPath = path.join(rootDir, "feedback-proof-branded.png");
  writeSolidPng(polishedPath, 320, 213, [4, 16, 36, 255]);
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
      polishedScreenshot: {
        path: polishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 96,
      },
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
  const historyDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.status, "published");
  assert.equal(historyDoc.rendered.entries[0].media.status, "published");
  assert.equal(latestDoc.rendered.entries[0].media.screenshotSource, "openai-polish");
  assert.equal(historyDoc.rendered.entries[0].media.screenshotSource, "openai-polish");
  assert.equal(latestDoc.rendered.entries[0].media.originalScreenshotSource, "capture-proof");
  assert.equal(latestDoc.rendered.entries[0].media.polishProvider, "fixture");
  assert.equal(latestDoc.rendered.entries[0].media.polishModel, "fixture-image-model");
  assert.equal(latestDoc.rendered.entries[0].media.polishJudgeModel, "fixture-judge-model");
  assert.equal(latestDoc.rendered.entries[0].media.polishScore, 96);
  assert.equal("failureClass" in latestDoc.rendered.entries[0].media, false);
  assert.equal(latestDoc.rendered.entries[1].media.status, "failed");
  assert.equal(latestDoc.rendered.entries[1].media.failureClass, "quality_gate");
  assert.match(latestDoc.rendered.entries[1].media.retryInstruction, /Retry correction pass:/);
  assert.equal(historyDoc.rendered.entries[1].media.status, "failed");
  assert.equal(historyDoc.rendered.entries[1].media.failureClass, "quality_gate");
  assert.equal(fs.existsSync(path.join(pagesDir, latestDoc.rendered.entries[0].media.assetPath)), true);
  assert.match(
    fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.md"), "utf8"),
    /!\[Feedback board screenshot\]\(\.\.\/\.\.\/assets\/changelog\/nightly\/0\.1\.0-nightly\.fixture\.1\/entry-1-feedback-board\.png\)/,
  );
  assert.match(
    fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.md"), "utf8"),
    /!\[Feedback board screenshot\]\(\.\.\/\.\.\/\.\.\/assets\/changelog\/nightly\/0\.1\.0-nightly\.fixture\.1\/entry-1-feedback-board\.png\)/,
  );
});

test("publish script fixture mode fails a slot when mandatory OpenAI polish is missing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-polish-fail-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
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
    },
    "entry-2-agent-create": {
      ok: false,
      inspectorUrl: "https://browserbase.example/session/failure",
      sessionId: "fixture-failure",
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 1, result.stderr || result.stdout);

  const summaryPath = path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.published, 0);
  assert.equal(summary.failed, 2);
  assert.equal(summary.results[0].failureClass, "openai_polish");
});

test("publish script fixture mode keeps workflow green when OpenAI polish partially succeeds", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-polish-partial-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
  const polishedPath = path.join(rootDir, "feedback-proof-branded.png");
  writeSolidPng(polishedPath, 320, 213, [4, 16, 36, 255]);
  const agentScreenshotPath = path.join(rootDir, "agent-proof.png");
  writeSolidPng(agentScreenshotPath, 320, 180, [120, 48, 210, 255]);
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
      polishedScreenshot: {
        path: polishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 94,
      },
    },
    "entry-2-agent-create": {
      ok: true,
      storyTitle: "Agent creation proof",
      phases: [
        {
          id: "capture-proof",
          success: true,
          screenshot: { path: agentScreenshotPath },
        },
      ],
      screenshots: [{ path: agentScreenshotPath }],
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
  assert.equal(summary.results[1].failureClass, "openai_polish");

  const retryPlan = JSON.parse(fs.readFileSync(path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-retry.json"), "utf8"));
  assert.equal(retryPlan.failed, 1);
  assert.equal(retryPlan.failedSlots[0].slotId, "entry-2-agent-create");
  assert.equal(retryPlan.failedSlots[0].failureClass, "openai_polish");

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.status, "published");
  assert.equal(latestDoc.rendered.entries[1].media.status, "failed");
  assert.equal(latestDoc.rendered.entries[1].media.failureClass, "openai_polish");
  assert.equal(fs.existsSync(path.join(pagesDir, latestDoc.rendered.entries[0].media.assetPath)), true);
});

test("publish script fixture mode still brands raw_contextual proof screenshots", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-raw-contextual-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  for (const filePath of [
    path.join(pagesDir, "changelog", "nightly", "latest.json"),
    path.join(pagesDir, "changelog", "nightly", "history", "2026-04-22.json"),
  ]) {
    const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    doc.rendered.entries[0].media.presentationMode = "raw_contextual";
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
  const polishedPath = path.join(rootDir, "feedback-proof-branded.png");
  writeSolidPng(polishedPath, 320, 213, [4, 16, 36, 255]);
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
      polishedScreenshot: {
        path: polishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 94,
      },
    },
    "entry-2-agent-create": {
      ok: false,
      inspectorUrl: "https://browserbase.example/session/failure",
      sessionId: "fixture-failure",
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.presentationMode, "raw_contextual");
  assert.equal(latestDoc.rendered.entries[0].media.status, "published");
  assert.equal(latestDoc.rendered.entries[0].media.screenshotSource, "openai-polish");
  assert.equal(latestDoc.rendered.entries[0].media.originalScreenshotSource, "capture-proof");
  assert.equal(latestDoc.rendered.entries[0].media.polishProvider, "fixture");
});

test("publish script accepts publishable polish when the judge boolean contradicts its score", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-polish-score-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
  const polishedPath = path.join(rootDir, "feedback-proof-branded.png");
  writeSolidPng(polishedPath, 320, 213, [4, 16, 36, 255]);
  const agentScreenshotPath = path.join(rootDir, "agent-proof.png");
  writeSolidPng(agentScreenshotPath, 320, 180, [120, 48, 210, 255]);
  const agentPolishedPath = path.join(rootDir, "agent-proof-branded.png");
  writeSolidPng(agentPolishedPath, 320, 213, [14, 26, 48, 255]);
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
      polishedScreenshot: {
        path: polishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        judge: {
          passed: false,
          proofVisible: true,
          score: 75,
          reasons: ["proof is visible and readable"],
          concerns: ["minor framing concern"],
          missingProof: [],
        },
      },
    },
    "entry-2-agent-create": {
      ok: true,
      storyTitle: "Agent creation proof",
      phases: [
        {
          id: "capture-proof",
          success: true,
          screenshot: { path: agentScreenshotPath },
        },
      ],
      screenshots: [{ path: agentScreenshotPath }],
      polishedScreenshot: {
        path: agentPolishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 91,
      },
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.status, "published");
  assert.equal(latestDoc.rendered.entries[0].media.polishFallbackReason, "");
  assert.equal(latestDoc.rendered.entries[0].media.polishScore, 75);
});

test("publish script fixture mode does not publish raw proof when branded polish loses the proof", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-fixture-polish-fallback-"));
  const repoDir = path.join(rootDir, "repo");
  const pagesDir = path.join(rootDir, "pages");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixtureChangelog({ pagesDir });

  const screenshotPath = path.join(rootDir, "feedback-proof.png");
  writeSolidPng(screenshotPath, 320, 180, [20, 120, 150, 255]);
  const polishedPath = path.join(rootDir, "feedback-proof-branded.png");
  writeSolidPng(polishedPath, 320, 213, [4, 16, 36, 255]);
  const agentScreenshotPath = path.join(rootDir, "agent-proof.png");
  writeSolidPng(agentScreenshotPath, 320, 180, [30, 100, 150, 255]);
  const agentPolishedPath = path.join(rootDir, "agent-proof-branded.png");
  writeSolidPng(agentPolishedPath, 320, 213, [4, 16, 36, 255]);
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
      polishedScreenshot: {
        path: polishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 52,
        judge: {
          passed: false,
          proofVisible: false,
          score: 52,
          reasons: ["background is readable"],
          concerns: ["proof surface is too small"],
          missingProof: ["Feedback"],
        },
      },
    },
    "entry-2-agent-create": {
      ok: true,
      storyTitle: "Agent creation proof",
      phases: [
        {
          id: "capture-proof",
          success: true,
          screenshot: { path: agentScreenshotPath },
        },
      ],
      screenshots: [{ path: agentScreenshotPath }],
      polishedScreenshot: {
        path: agentPolishedPath,
        provider: "fixture",
        model: "fixture-image-model",
        judgeModel: "fixture-judge-model",
        score: 94,
      },
      sessionId: "fixture-success",
    },
  }, null, 2)}\n`);

  const result = runPublishMediaFixture({ pagesDir, repoDir, fixtureResultsPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const summaryPath = path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media", "publish-changelog-media-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.workflowOutcome, "partial");
  assert.equal(summary.shouldFailWorkflow, false);
  assert.equal(summary.results[0].status, "failed");
  assert.equal(summary.results[0].failureClass, "openai_polish");
  assert.match(summary.results[0].error, /OpenAI branded media judge rejected/);
  assert.equal(summary.results[1].status, "published");
  assert.equal(summary.results[1].screenshotSource, "openai-polish");
  assert.equal(summary.results[1].polishFallbackReason, null);

  const latestDoc = JSON.parse(fs.readFileSync(path.join(pagesDir, "changelog", "nightly", "latest.json"), "utf8"));
  assert.equal(latestDoc.rendered.entries[0].media.status, "failed");
  assert.equal(latestDoc.rendered.entries[0].media.assetPath || "", "");
  assert.equal(latestDoc.rendered.entries[0].media.failureClass, "openai_polish");
  assert.equal(latestDoc.rendered.entries[1].media.status, "published");
  assert.equal(latestDoc.rendered.entries[1].media.screenshotSource, "openai-polish");
  assert.equal(fs.existsSync(path.join(pagesDir, latestDoc.rendered.entries[1].media.assetPath)), true);
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
