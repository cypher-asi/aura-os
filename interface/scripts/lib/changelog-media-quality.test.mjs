import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessChangelogMediaQuality,
  buildVisionJudgePrompt,
  judgeChangelogMediaWithAnthropic,
  measurePngQuality,
} from "./changelog-media-quality.mjs";

function writePng(filePath, width, height, paint) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((width * y) + x) * 4;
      const color = paint(x, y);
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = color[3] ?? 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

test("measurePngQuality detects visual structure", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "structured.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const metrics = measurePngQuality(fs.readFileSync(screenshotPath));

  assert.equal(metrics.ok, true);
  assert.equal(metrics.width, 160);
  assert.equal(metrics.height, 90);
  assert.ok(metrics.lumaStdDev > 20);
  assert.ok(metrics.edgeDensity > 0.01);
});

test("assessChangelogMediaQuality accepts structured desktop proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 1920, 1080, (x, y) => ((x + y) % 48 < 24 ? [18, 24, 38] : [238, 242, 248]));

  const report = assessChangelogMediaQuality({
    desktopEvaluation: {
      ok: true,
      concerns: [],
      parsedOutput: {
        shouldCapture: true,
        targetAppId: "agents",
        targetPath: "/agents",
        proofVisible: true,
        visibleProof: ["The GPT-5.5 option is visible in the model picker."],
        screenshotDescription: "Aura desktop chat model picker.",
      },
    },
    screenshot: {
      path: screenshotPath,
      dimensions: { width: 1920, height: 1080 },
    },
    candidate: {
      targetAppId: "agents",
      targetPath: "/agents",
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.concerns, []);
});

test("assessChangelogMediaQuality does not reject normal input placeholder copy", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop-placeholder-text.png");
  writePng(screenshotPath, 1920, 1080, (x, y) => ((x + y) % 48 < 24 ? [18, 24, 38] : [238, 242, 248]));

  const report = assessChangelogMediaQuality({
    desktopEvaluation: {
      ok: true,
      concerns: [],
      parsedOutput: {
        shouldCapture: true,
        targetAppId: "agents",
        targetPath: "/agents/33333333-3333-4333-8333-333333333333",
        proofVisible: true,
        visibleProof: [
          "GPT-5.5 is visible in the model picker.",
          "ChatInputBar is visible with placeholder text.",
        ],
        screenshotDescription: "Aura desktop chat screen with model picker dropdown open.",
      },
    },
    screenshot: {
      path: screenshotPath,
      dimensions: { width: 1920, height: 1080 },
    },
    candidate: {
      targetAppId: "agents",
      targetPath: "/agents",
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.concerns, []);
});

test("assessChangelogMediaQuality rejects low-resolution proof even when semantics pass", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "low-resolution.png");
  writePng(screenshotPath, 1536, 608, (x, y) => ((x + y) % 48 < 24 ? [18, 24, 38] : [238, 242, 248]));

  const report = assessChangelogMediaQuality({
    desktopEvaluation: {
      ok: true,
      concerns: [],
      parsedOutput: {
        shouldCapture: true,
        targetAppId: "agents",
        targetPath: "/agents",
        proofVisible: true,
        visibleProof: ["GPT-5.5 is visible in the model picker."],
        screenshotDescription: "Aura desktop chat screen with model picker dropdown open.",
      },
    },
    screenshot: {
      path: screenshotPath,
      dimensions: { width: 1536, height: 608 },
    },
    candidate: {
      targetAppId: "agents",
      targetPath: "/agents",
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("below production readability minimum")));
});

test("assessChangelogMediaQuality rejects weak or unrelated proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "flat.png");
  writePng(screenshotPath, 160, 90, () => [8, 8, 8]);

  const report = assessChangelogMediaQuality({
    desktopEvaluation: {
      ok: true,
      concerns: [],
      parsedOutput: {
        shouldCapture: true,
        targetAppId: "settings",
        targetPath: "/settings",
        proofVisible: true,
        visibleProof: ["Login required before the feature can be shown."],
        screenshotDescription: "Login screen.",
      },
    },
    screenshot: {
      path: screenshotPath,
      dimensions: { width: 160, height: 90 },
    },
    candidate: {
      targetAppId: "agents",
      targetPath: "/agents",
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("below production readability minimum")));
  assert.ok(report.concerns.some((concern) => concern.includes("login")));
  assert.ok(report.concerns.some((concern) => concern.includes("expected agents")));
});

test("buildVisionJudgePrompt defines an independent strict review", () => {
  const prompt = buildVisionJudgePrompt({
    candidate: {
      entryId: "entry-1",
      title: "GPT-5.5 available in the model picker",
      proofGoal: "Show GPT-5.5 in the model picker.",
    },
    stage: "branded",
  });

  assert.match(prompt, /independent quality judge/);
  assert.match(prompt, /not a login, loading, placeholder, empty, or error page/);
  assert.match(prompt, /pixelated/);
  assert.match(prompt, /easy to find without zooming/);
  assert.match(prompt, /public-facing/);
  assert.match(prompt, /Return strict JSON/);
});

test("judgeChangelogMediaWithAnthropic requires strict vision proof", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  let requestBody = null;
  const report = await judgeChangelogMediaWithAnthropic({
    apiKey: "test-key",
    imagePath: screenshotPath,
    candidate: {
      entryId: "entry-1",
      title: "GPT-5.5 available in the model picker",
      proofGoal: "Show GPT-5.5 in the picker.",
    },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "submit_changelog_media_quality",
                input: {
                  pass: true,
                  score: 0.91,
                  reasons: ["The model picker is visible and readable."],
                  visibleProof: ["GPT-5.5 is visible in the model picker."],
                  rejectionCategory: null,
                },
              },
            ],
          });
        },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "accepted");
  assert.equal(report.judgment.score, 0.91);
  assert.equal(requestBody.tool_choice.name, "submit_changelog_media_quality");
  assert.equal(requestBody.messages[0].content[1].type, "image");
  assert.equal(requestBody.messages[0].content[1].source.media_type, "image/png");
});

test("judgeChangelogMediaWithAnthropic rejects marginal vision scores", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const report = await judgeChangelogMediaWithAnthropic({
    apiKey: "test-key",
    imagePath: screenshotPath,
    candidate: {
      entryId: "entry-1",
      title: "GPT-5.5 available in the model picker",
      proofGoal: "Show GPT-5.5 in the picker.",
    },
    stage: "branded",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "submit_changelog_media_quality",
              input: {
                pass: true,
                score: 0.7,
                reasons: ["The correct screen is visible, but text is soft."],
                visibleProof: ["GPT-5.5 is present."],
                rejectionCategory: null,
              },
            },
          ],
        });
      },
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "rejected");
  assert.ok(report.concerns.some((concern) => concern.includes("minimum 0.75")));
});

test("judgeChangelogMediaWithAnthropic rejects images with a rejection category even when scored high", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const report = await judgeChangelogMediaWithAnthropic({
    apiKey: "test-key",
    imagePath: screenshotPath,
    stage: "raw",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "submit_changelog_media_quality",
              input: {
                pass: true,
                score: 0.93,
                reasons: ["A product screen is visible but it is the wrong area."],
                visibleProof: ["Unrelated screen is visible."],
                rejectionCategory: "wrong-screen",
              },
            },
          ],
        });
      },
    }),
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("wrong-screen")));
});
