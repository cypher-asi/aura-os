import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessBrandedMediaAsset,
  calculateBrandedCanvas,
  createBrandedMediaSvg,
  readPngDimensionsFromFile,
  wrapTextForSvg,
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

test("calculateBrandedCanvas keeps screenshot at native size", () => {
  const canvas = calculateBrandedCanvas({ width: 1920, height: 1080 });

  assert.ok(canvas.width > 1920);
  assert.ok(canvas.height > 1080);
  assert.equal(canvas.screenshot.width, 1920);
  assert.equal(canvas.screenshot.height, 1080);
});

test("createBrandedMediaSvg wraps the raw screenshot without scaling it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const screenshotPath = path.join(tempDir, "screenshot.png");
  const outputPath = path.join(tempDir, "branded.svg");
  writePng(screenshotPath, 640, 360);

  const asset = createBrandedMediaSvg({
    screenshotPath,
    outputPath,
    title: "GPT-5.5 available in the chat model picker",
    subtitle: "Open the picker and show the model option.",
  });

  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(asset.embeddedScreenshot.scale, 1);
  assert.equal(asset.embeddedScreenshot.renderedWidth, 640);
  assert.equal(asset.embeddedScreenshot.renderedHeight, 360);
  assert.ok(asset.layout.titleLines > 0 && asset.layout.titleLines <= asset.layout.maxTitleLines);
  assert.equal(asset.layout.subtitleLines, 1);
  assert.ok(Math.abs(asset.layout.aspectRatio - (16 / 9)) < 0.02);
  assert.equal(assessBrandedMediaAsset(asset).ok, true);

  const svg = fs.readFileSync(outputPath, "utf8");
  assert.match(svg, /AURA CHANGELOG/);
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, /GPT-5.5 available/);
  assert.match(svg, /<tspan x="/);
});

test("assessBrandedMediaAsset rejects canvas and layout regressions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-branding-"));
  const screenshotPath = path.join(tempDir, "screenshot.png");
  const outputPath = path.join(tempDir, "branded.svg");
  writePng(screenshotPath, 640, 360);

  const asset = createBrandedMediaSvg({
    screenshotPath,
    outputPath,
    title: "GPT-5.5 available in the chat model picker",
    subtitle: "Open the picker and show the model option.",
  });
  const report = assessBrandedMediaAsset({
    ...asset,
    dimensions: { width: 1000, height: 1000 },
    layout: {
      ...asset.layout,
      titleLines: 3,
      screenshot: { x: 700, y: 700, width: 640, height: 360 },
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("16:9")));
  assert.ok(report.concerns.some((concern) => concern.includes("title layout")));
  assert.ok(report.concerns.some((concern) => concern.includes("overflows the canvas width")));
});

test("wrapTextForSvg caps long marketing copy to bounded lines", () => {
  const lines = wrapTextForSvg(
    "Open the chat model picker in the ChatInputBar and capture the dropdown showing GPT-5.5 listed as an available model option.",
    { fontSize: 26, maxWidth: 620, maxLines: 2 },
  );

  assert.equal(lines.length, 2);
  assert.match(lines.at(-1), /\.\.\.$/);
});
