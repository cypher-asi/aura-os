import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessChangelogMediaQuality,
  buildVisionJudgePrompt,
  judgeChangelogMediaWithOpenAI,
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

test("assessChangelogMediaQuality rejects generic empty-state proof copy", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "empty-state.png");
  writePng(screenshotPath, 1920, 1080, (x, y) => ((x + y) % 48 < 24 ? [18, 24, 38] : [238, 242, 248]));

  const report = assessChangelogMediaQuality({
    desktopEvaluation: {
      ok: true,
      concerns: [],
      parsedOutput: {
        shouldCapture: true,
        targetAppId: "debug",
        targetPath: "/debug",
        proofVisible: true,
        visibleProof: [
          "Pick a project on the left to browse its runs.",
          "Select a run to see details.",
        ],
        screenshotDescription: "Debug empty state.",
      },
    },
    screenshot: {
      path: screenshotPath,
      dimensions: { width: 1920, height: 1080 },
    },
    candidate: {
      targetAppId: "debug",
      targetPath: "/debug",
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("placeholder UI")));
});

test("buildVisionJudgePrompt defines an independent strict review", () => {
  const prompt = buildVisionJudgePrompt({
    candidate: {
      entryId: "entry-1",
      title: "GPT-5.5 available in the model picker",
      proofGoal: "Show GPT-5.5 in the model picker.",
    },
    stage: "branded",
    hasReferenceImage: true,
  });

  assert.match(prompt, /independent quality judge/);
  assert.match(prompt, /not a login, loading, or error page/);
  assert.match(prompt, /For product feature proof, it is not a placeholder or empty state/);
  assert.match(prompt, /Judge the visible product proof, not internal routing metadata/);
  assert.match(prompt, /targetAppId\/targetPath are verified by deterministic gates outside the image/);
  assert.match(prompt, /pixelated/);
  assert.match(prompt, /Meaningful product text must be sharp enough to read without guessing/);
  assert.match(prompt, /generated product text is softer, less readable, or more artificial than the source/);
  assert.match(prompt, /textIntegrity must be preserved/);
  assert.match(prompt, /hallucinatedText must be empty/);
  assert.match(prompt, /easy to find without zooming/);
  assert.match(prompt, /public-facing/);
  assert.match(prompt, /Return strict JSON/);
});

test("buildVisionJudgePrompt allows sparse support state for shell layout proof", () => {
  const prompt = buildVisionJudgePrompt({
    candidate: {
      entryId: "entry-shell",
      title: "Floating glass desktop shell with capsule taskbar",
      proofGoal: "Show the refreshed floating desktop shell with rounded panels and a three-capsule bottom taskbar.",
    },
    stage: "raw",
  });

  assert.match(prompt, /primaryProofKind": "desktop-shell-layout"/);
  assert.match(prompt, /Do not reject solely because the supporting app content is sparse/);
  assert.match(prompt, /bottom taskbar capsules/);
  assert.doesNotMatch(prompt, /For product feature proof, it is not a placeholder or empty state/);
});

test("judgeChangelogMediaWithOpenAI uses Responses image input and strict JSON schema", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  let requestBody = null;
  const report = await judgeChangelogMediaWithOpenAI({
    apiKey: "test-key",
    model: "gpt-5.2",
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
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      pass: true,
                      score: 0.92,
                      reasons: ["The product UI is crisp and relevant."],
                      visibleProof: ["GPT-5.5 is visible in the model picker."],
                      rejectionCategory: null,
                      textIntegrity: "preserved",
                      hallucinatedText: [],
                    }),
                  },
                ],
              },
            ],
          });
        },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "accepted");
  assert.equal(report.judgment.score, 0.92);
  assert.equal(requestBody.model, "gpt-5.2");
  assert.equal(requestBody.input[0].content[0].type, "input_text");
  assert.equal(requestBody.input[0].content[1].type, "input_image");
  assert.match(requestBody.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.ok(requestBody.text.format.schema.required.includes("textIntegrity"));
  assert.ok(requestBody.text.format.schema.required.includes("hallucinatedText"));
});

test("judgeChangelogMediaWithOpenAI rejects marginal vision scores", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const report = await judgeChangelogMediaWithOpenAI({
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
          output: [
            {
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  pass: true,
                  score: 0.7,
                  reasons: ["The correct screen is visible, but text is soft."],
                  visibleProof: ["GPT-5.5 is present."],
                  rejectionCategory: null,
                  textIntegrity: "preserved",
                  hallucinatedText: [],
                }),
              }],
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

test("judgeChangelogMediaWithOpenAI rejects images with a rejection category even when scored high", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const screenshotPath = path.join(tempDir, "desktop.png");
  writePng(screenshotPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const report = await judgeChangelogMediaWithOpenAI({
    apiKey: "test-key",
    imagePath: screenshotPath,
    stage: "raw",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          output: [
            {
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  pass: true,
                  score: 0.93,
                  reasons: ["A product screen is visible but it is the wrong area."],
                  visibleProof: ["Unrelated screen is visible."],
                  rejectionCategory: "wrong-screen",
                  textIntegrity: "preserved",
                  hallucinatedText: [],
                }),
              }],
            },
          ],
        });
      },
    }),
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("wrong-screen")));
});

test("judgeChangelogMediaWithOpenAI rejects generated images that rewrite source text", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-quality-"));
  const sourcePath = path.join(tempDir, "source.png");
  const generatedPath = path.join(tempDir, "generated.png");
  writePng(sourcePath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));
  writePng(generatedPath, 160, 90, (x, y) => ((x + y) % 24 < 12 ? [18, 24, 38] : [238, 242, 248]));

  const report = await judgeChangelogMediaWithOpenAI({
    apiKey: "test-key",
    imagePath: generatedPath,
    referenceImagePath: sourcePath,
    stage: "branded",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          output: [
            {
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  pass: true,
                  score: 0.92,
                  reasons: ["The image is polished but one source label was rewritten."],
                  visibleProof: ["GPT-5.5 is visible."],
                  rejectionCategory: null,
                  textIntegrity: "materially-changed",
                  hallucinatedText: ["'/aura capture team' became '^a capture team'"],
                }),
              }],
            },
          ],
        });
      },
    }),
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("generated text drift")));
});
