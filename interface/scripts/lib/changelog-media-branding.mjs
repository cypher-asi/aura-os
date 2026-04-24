import fs from "node:fs";
import path from "node:path";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function readPngDimensionsFromFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Expected a PNG screenshot: ${filePath}`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function calculateBrandedCanvas(screenshotDimensions) {
  const screenshotWidth = screenshotDimensions.width;
  const screenshotHeight = screenshotDimensions.height;
  const horizontalPad = clamp(Math.round(screenshotWidth * 0.16), 180, 360);
  const topPad = clamp(Math.round(screenshotHeight * 0.18), 140, 240);
  const bottomPad = clamp(Math.round(screenshotHeight * 0.12), 110, 200);
  const contentWidth = screenshotWidth + (horizontalPad * 2);
  const contentHeight = screenshotHeight + topPad + bottomPad;
  const canvasWidth = Math.ceil(Math.max(contentWidth, contentHeight * (16 / 9)));
  const canvasHeight = Math.ceil(canvasWidth * (9 / 16));
  const screenshotX = Math.round((canvasWidth - screenshotWidth) / 2);
  const screenshotY = Math.round((canvasHeight - screenshotHeight) / 2 + Math.round(topPad * 0.18));

  return {
    width: canvasWidth,
    height: canvasHeight,
    screenshot: {
      x: screenshotX,
      y: screenshotY,
      width: screenshotWidth,
      height: screenshotHeight,
    },
    title: {
      x: screenshotX,
      y: Math.max(70, screenshotY - 72),
    },
    label: {
      x: screenshotX,
      y: Math.max(38, screenshotY - 116),
    },
  };
}

export function createBrandedMediaSvg({
  screenshotPath,
  outputPath,
  title,
  subtitle = "Aura changelog proof",
  label = "Aura",
} = {}) {
  if (!screenshotPath) {
    throw new Error("screenshotPath is required.");
  }
  if (!outputPath) {
    throw new Error("outputPath is required.");
  }

  const dimensions = readPngDimensionsFromFile(screenshotPath);
  const canvas = calculateBrandedCanvas(dimensions);
  const dataUri = `data:image/png;base64,${fs.readFileSync(screenshotPath).toString("base64")}`;
  const safeTitle = escapeXml(title || "Aura product update");
  const safeSubtitle = escapeXml(subtitle);
  const safeLabel = escapeXml(label);
  const radius = clamp(Math.round(dimensions.width * 0.018), 18, 32);
  const shadowOffset = clamp(Math.round(dimensions.height * 0.04), 24, 56);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="aura-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#090b10"/>
      <stop offset="0.42" stop-color="#111827"/>
      <stop offset="1" stop-color="#020407"/>
    </linearGradient>
    <radialGradient id="aura-glow" cx="50%" cy="8%" r="68%">
      <stop offset="0" stop-color="#6ee7f9" stop-opacity="0.26"/>
      <stop offset="0.42" stop-color="#60a5fa" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#020407" stop-opacity="0"/>
    </radialGradient>
    <filter id="card-shadow" x="-8%" y="-8%" width="116%" height="124%">
      <feDropShadow dx="0" dy="${shadowOffset}" stdDeviation="${Math.round(shadowOffset * 0.58)}" flood-color="#000000" flood-opacity="0.44"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#aura-bg)"/>
  <rect width="100%" height="100%" fill="url(#aura-glow)"/>
  <circle cx="${Math.round(canvas.width * 0.84)}" cy="${Math.round(canvas.height * 0.18)}" r="${Math.round(canvas.width * 0.22)}" fill="#38bdf8" opacity="0.08"/>
  <circle cx="${Math.round(canvas.width * 0.12)}" cy="${Math.round(canvas.height * 0.82)}" r="${Math.round(canvas.width * 0.18)}" fill="#f8fafc" opacity="0.04"/>
  <text x="${canvas.label.x}" y="${canvas.label.y}" fill="#94a3b8" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${clamp(Math.round(canvas.width * 0.018), 22, 34)}" font-weight="700" letter-spacing="4">${safeLabel.toUpperCase()} CHANGELOG</text>
  <text x="${canvas.title.x}" y="${canvas.title.y}" fill="#f8fafc" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${clamp(Math.round(canvas.width * 0.026), 34, 56)}" font-weight="650">${safeTitle}</text>
  <text x="${canvas.title.x}" y="${canvas.title.y + clamp(Math.round(canvas.width * 0.024), 32, 48)}" fill="#cbd5e1" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${clamp(Math.round(canvas.width * 0.014), 18, 26)}" font-weight="500">${safeSubtitle}</text>
  <g filter="url(#card-shadow)">
    <rect x="${canvas.screenshot.x - 1}" y="${canvas.screenshot.y - 1}" width="${canvas.screenshot.width + 2}" height="${canvas.screenshot.height + 2}" rx="${radius + 1}" fill="#ffffff" opacity="0.16"/>
    <image href="${dataUri}" x="${canvas.screenshot.x}" y="${canvas.screenshot.y}" width="${canvas.screenshot.width}" height="${canvas.screenshot.height}" preserveAspectRatio="none" clip-path="inset(0 round ${radius}px)"/>
  </g>
</svg>
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, svg, "utf8");

  return {
    path: outputPath,
    format: "svg",
    dimensions: {
      width: canvas.width,
      height: canvas.height,
    },
    embeddedScreenshot: {
      path: screenshotPath,
      width: dimensions.width,
      height: dimensions.height,
      bytes: dimensions.bytes,
      renderedWidth: canvas.screenshot.width,
      renderedHeight: canvas.screenshot.height,
      scale: 1,
    },
  };
}

export function assessBrandedMediaAsset(asset) {
  const concerns = [];
  if (!asset?.path || !fs.existsSync(asset.path)) {
    concerns.push("Branded media asset was not created.");
  }
  if (asset?.embeddedScreenshot?.scale !== 1) {
    concerns.push("Branded media changed the product screenshot scale.");
  }
  if (asset?.embeddedScreenshot?.width !== asset?.embeddedScreenshot?.renderedWidth) {
    concerns.push("Branded media changed the product screenshot width.");
  }
  if (asset?.embeddedScreenshot?.height !== asset?.embeddedScreenshot?.renderedHeight) {
    concerns.push("Branded media changed the product screenshot height.");
  }
  return {
    ok: concerns.length === 0,
    status: concerns.length === 0 ? "accepted" : "rejected",
    concerns,
  };
}
