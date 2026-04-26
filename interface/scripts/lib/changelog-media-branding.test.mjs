import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessBrandedMediaAsset,
  createOpenAIProductionMediaImage,
  readPngDimensionsFromFile,
} from "./changelog-media-branding.mjs";

function writePng(filePath, width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((width * y) + x) * 4;
      png.data[offset] = x % 32 < 16 ? 14 : 230;
      png.data[offset + 1] = y % 32 < 16 ? 24 : 240;
      png.data[offset + 2] = 48;
      png.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function fakeOpenAIAsset({
  imagePath,
  sourcePath,
  width = 2560,
  height = 1440,
  sourceWidth = 3840,
  sourceHeight = 2160,
} = {}) {
  const bytes = fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0;
  return {
    path: imagePath,
    format: "png",
    dimensions: { width, height },
    bytes,
    layout: {
      aspectRatio: width / height,
      labelLines: 0,
      titleLines: 0,
      subtitleLines: 0,
      maxTitleLines: 0,
      maxSubtitleLines: 0,
      screenshot: { x: 0, y: 0, width, height },
    },
    embeddedScreenshot: {
      path: sourcePath,
      width: sourceWidth,
      height: sourceHeight,
      bytes,
      renderedWidth: sourceWidth,
      renderedHeight: sourceHeight,
      scale: 1,
      treatment: "openai-production-redraw",
    },
    preview: {
      path: imagePath,
      format: "png",
      dimensions: { width, height },
      bytes,
    },
    generation: {
      provider: "openai",
      model: "gpt-image-2",
      quality: "high",
      size: "2560x1440",
    },
  };
}

test("readPngDimensionsFromFile extracts PNG dimensions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const screenshotPath = path.join(tempDir, "screenshot.png");
  writePng(screenshotPath, 640, 360);

  assert.deepEqual(readPngDimensionsFromFile(screenshotPath), {
    width: 640,
    height: 360,
    bytes: fs.statSync(screenshotPath).size,
  });
});

test("createOpenAIProductionMediaImage sends the proof screenshot for high-quality production redraw", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const sourcePath = path.join(tempDir, "source.png");
  const outputPath = path.join(tempDir, "openai-production-media.png");
  writePng(sourcePath, 1920, 1080);
  const sourceBase64 = fs.readFileSync(sourcePath).toString("base64");
  const calls = [];

  const result = await createOpenAIProductionMediaImage({
    apiKey: "openai-test-key",
    model: "gpt-image-2",
    inputImagePath: sourcePath,
    outputPath,
    candidate: {
      title: "GPT-5.5 available in the chat model picker",
      proofGoal: "Show the chat model picker with GPT-5.5 visible.",
      targetAppId: "agents",
      targetPath: "/agents",
    },
    rawVisionGate: {
      judgment: {
        reasons: ["The source screenshot is relevant but slightly distant."],
      },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ b64_json: sourceBase64 }] });
        },
      };
    },
  });

  assert.equal(result.status, "created");
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(result.asset.generation.provider, "openai");
  assert.equal(result.asset.generation.model, "gpt-image-2");
  assert.equal(result.asset.generation.quality, "high");
  assert.equal(result.asset.generation.size, "2560x1440");
  assert.equal(result.asset.embeddedScreenshot.path, sourcePath);
  assert.equal(result.asset.embeddedScreenshot.scale, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer openai-test-key");
  assert.equal(calls[0].options.body.get("model"), "gpt-image-2");
  assert.equal(calls[0].options.body.get("quality"), "high");
  assert.equal(calls[0].options.body.get("size"), "2560x1440");
  assert.match(calls[0].options.body.get("prompt"), /Preserve visible app text faithfully/);
  assert.match(calls[0].options.body.get("prompt"), /do not abbreviate, garble, crop, or partially hide labels/);
  assert.match(calls[0].options.body.get("prompt"), /Preserve the exact count, position, size relationship/);
  assert.match(calls[0].options.body.get("prompt"), /Do not make subtle proof elements more prominent/);
  assert.match(calls[0].options.body.get("prompt"), /omit or de-emphasize that edge text rather than guessing/);
  assert.equal(calls[0].options.body.get("image").type, "image/png");
});

test("assessBrandedMediaAsset accepts OpenAI production media with full-source proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const imagePath = path.join(tempDir, "openai-production-media.png");
  const sourcePath = path.join(tempDir, "source.png");
  writePng(imagePath, 2560, 1440);
  writePng(sourcePath, 3840, 2160);

  const report = assessBrandedMediaAsset(fakeOpenAIAsset({ imagePath, sourcePath }));

  assert.equal(report.ok, true);
  assert.deepEqual(report.concerns, []);
});

test("assessBrandedMediaAsset rejects low-resolution source proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const imagePath = path.join(tempDir, "openai-production-media.png");
  const sourcePath = path.join(tempDir, "source.png");
  writePng(imagePath, 2560, 1440);
  writePng(sourcePath, 1536, 864);

  const report = assessBrandedMediaAsset(fakeOpenAIAsset({
    imagePath,
    sourcePath,
    sourceWidth: 1536,
    sourceHeight: 864,
  }));

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("below production readability minimum")));
});

test("assessBrandedMediaAsset rejects generated media layout regressions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const imagePath = path.join(tempDir, "openai-production-media.png");
  const sourcePath = path.join(tempDir, "source.png");
  writePng(imagePath, 1000, 1000);
  writePng(sourcePath, 3840, 2160);

  const report = assessBrandedMediaAsset(fakeOpenAIAsset({
    imagePath,
    sourcePath,
    width: 1000,
    height: 1000,
  }));

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("16:9")));
});
