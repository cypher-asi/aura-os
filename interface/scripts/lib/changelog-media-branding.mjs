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

const PRODUCTION_BRANDED_MEDIA_POLICY = Object.freeze({
  minEmbeddedWidth: 1920,
  minEmbeddedHeight: 1080,
  minEmbeddedAreaRatio: 0.5,
  minEmbeddedWidthRatio: 0.72,
  minEmbeddedHeightRatio: 0.48,
});

function addEllipsis(value, maxChars) {
  if (value.length <= maxChars) {
    return value.endsWith("...") ? value : `${value}...`;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function wrapTextForSvg(value, { fontSize, maxWidth, maxLines = 2 } = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return [];
  }

  const maxChars = Math.max(12, Math.floor(maxWidth / Math.max(1, fontSize * 0.56)));
  const words = text.split(" ");
  const lines = [];
  let current = "";
  let truncated = false;

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(addEllipsis(word, maxChars));
      current = "";
      truncated = true;
    }

    if (lines.length >= maxLines) {
      truncated = true;
      current = "";
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current) {
    truncated = true;
  }

  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = addEllipsis(lines[lines.length - 1], maxChars);
  }

  return lines.slice(0, maxLines);
}

function renderTextLines({ lines, x, y, lineHeight, attributes }) {
  if (!lines.length) {
    return "";
  }
  const tspans = lines
    .map((line, index) => `    <tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("\n");
  return `  <text x="${x}" y="${y}" ${attributes}>\n${tspans}\n  </text>`;
}

export function calculateBrandedCanvas(screenshotDimensions, { headerHeight } = {}) {
  const screenshotWidth = screenshotDimensions.width;
  const screenshotHeight = screenshotDimensions.height;
  const horizontalPad = clamp(Math.round(screenshotWidth * 0.16), 180, 360);
  const topPad = Math.max(
    clamp(Math.round(screenshotHeight * 0.22), 180, 300),
    Math.round(headerHeight || 0),
  );
  const bottomPad = clamp(Math.round(screenshotHeight * 0.12), 110, 200);
  const contentWidth = screenshotWidth + (horizontalPad * 2);
  const contentHeight = screenshotHeight + topPad + bottomPad;
  const canvasWidth = Math.ceil(Math.max(contentWidth, contentHeight * (16 / 9)));
  const canvasHeight = Math.ceil(canvasWidth * (9 / 16));
  const screenshotX = Math.round((canvasWidth - screenshotWidth) / 2);
  const contentTop = Math.max(0, Math.round((canvasHeight - contentHeight) / 2));
  const screenshotY = Math.round(contentTop + topPad);

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
      y: Math.max(96, contentTop + 118),
    },
    label: {
      x: screenshotX,
      y: Math.max(38, contentTop + 34),
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
  const baseCanvas = calculateBrandedCanvas(dimensions);
  const labelFontSize = clamp(Math.round(baseCanvas.width * 0.018), 22, 34);
  const titleFontSize = clamp(Math.round(baseCanvas.width * 0.026), 34, 56);
  const subtitleFontSize = clamp(Math.round(baseCanvas.width * 0.014), 18, 26);
  const titleLineHeight = Math.round(titleFontSize * 1.12);
  const subtitleLineHeight = Math.round(subtitleFontSize * 1.36);
  const labelTitleGap = clamp(Math.round(baseCanvas.width * 0.012), 28, 52);
  const titleLines = wrapTextForSvg(title || "Aura product update", {
    fontSize: titleFontSize,
    maxWidth: dimensions.width,
    maxLines: 2,
  });
  const subtitleLines = wrapTextForSvg(subtitle, {
    fontSize: subtitleFontSize,
    maxWidth: dimensions.width,
    maxLines: 2,
  });
  const headerHeight = labelFontSize
    + labelTitleGap
    + (titleLines.length * titleLineHeight)
    + (subtitleLines.length ? Math.round(subtitleFontSize * 0.95) : 0)
    + (subtitleLines.length * subtitleLineHeight)
    + 52;
  const canvas = calculateBrandedCanvas(dimensions, { headerHeight });
  const dataUri = `data:image/png;base64,${fs.readFileSync(screenshotPath).toString("base64")}`;
  const safeTitle = escapeXml(title || "Aura product update");
  const safeLabel = escapeXml(label);
  const radius = clamp(Math.round(dimensions.width * 0.018), 18, 32);
  const shadowOffset = clamp(Math.round(dimensions.height * 0.04), 24, 56);
  const labelText = `${safeLabel.toUpperCase()} CHANGELOG`;
  const titleY = canvas.label.y + labelFontSize + labelTitleGap;
  const subtitleY = titleY
    + (Math.max(1, titleLines.length) * titleLineHeight)
    + Math.round(subtitleFontSize * 1.2);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="aura-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#05070c"/>
      <stop offset="0.46" stop-color="#111827"/>
      <stop offset="1" stop-color="#070a12"/>
    </linearGradient>
    <radialGradient id="aura-glow" cx="52%" cy="0%" r="72%">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity="0.18"/>
      <stop offset="0.42" stop-color="#60a5fa" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#070a12" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="aura-corner" cx="84%" cy="20%" r="54%">
      <stop offset="0" stop-color="#334155" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <filter id="card-shadow" x="-8%" y="-8%" width="116%" height="124%">
      <feDropShadow dx="0" dy="${shadowOffset}" stdDeviation="${Math.round(shadowOffset * 0.58)}" flood-color="#000000" flood-opacity="0.44"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#aura-bg)"/>
  <rect width="100%" height="100%" fill="url(#aura-glow)"/>
  <rect width="100%" height="100%" fill="url(#aura-corner)"/>
  <text x="${canvas.label.x}" y="${canvas.label.y}" fill="#9aa8bd" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${labelFontSize}" font-weight="750" letter-spacing="5.5">${labelText}</text>
${renderTextLines({
    lines: titleLines,
    x: canvas.title.x,
    y: titleY,
    lineHeight: titleLineHeight,
    attributes: `fill="#f8fafc" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${titleFontSize}" font-weight="650"`,
  })}
${renderTextLines({
    lines: subtitleLines,
    x: canvas.title.x,
    y: subtitleY,
    lineHeight: subtitleLineHeight,
    attributes: `fill="#cbd5e1" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${subtitleFontSize}" font-weight="500"`,
  })}
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
    layout: {
      aspectRatio: canvas.width / canvas.height,
      labelLines: 1,
      titleLines: titleLines.length,
      subtitleLines: subtitleLines.length,
      maxTitleLines: 2,
      maxSubtitleLines: 2,
      screenshot: canvas.screenshot,
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

export async function createBrandedMediaPngPreview({ svgPath, outputPath } = {}) {
  if (!svgPath) {
    throw new Error("svgPath is required.");
  }
  if (!outputPath) {
    throw new Error("outputPath is required.");
  }
  const sharp = (await import("sharp")).default;
  const info = await sharp(svgPath)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return {
    path: outputPath,
    format: "png",
    dimensions: {
      width: info.width,
      height: info.height,
    },
    bytes: info.size,
  };
}

async function neutralizeDarkChroma(sharp, inputBuffer) {
  const image = sharp(inputBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const neutralBase = { r: 5, g: 7, b: 12 };

  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const luma = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    const chroma = maxChannel - minChannel;

    if (luma < 36 && chroma > 3) {
      const lift = Math.round(luma * 0.34);
      data[index] = Math.min(255, neutralBase.r + lift);
      data[index + 1] = Math.min(255, neutralBase.g + lift);
      data[index + 2] = Math.min(255, neutralBase.b + lift);
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

export async function createBrandingFocusScreenshot({
  screenshotPath,
  outputPath,
  minWidth = 1920,
  minHeight = 1080,
  maxWidth = 3840,
  maxHeight = 2160,
  background = { r: 5, g: 7, b: 10, alpha: 1 },
} = {}) {
  if (!screenshotPath) {
    throw new Error("screenshotPath is required.");
  }
  if (!outputPath) {
    throw new Error("outputPath is required.");
  }

  const sharp = (await import("sharp")).default;
  const trimmed = await sharp(screenshotPath)
    .trim({ background, threshold: 20 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const width = trimmed.info.width || minWidth;
  const height = trimmed.info.height || minHeight;
  const targetRatio = 16 / 9;
  let targetWidth = Math.max(width, minWidth, Math.ceil(height * targetRatio));
  let targetHeight = Math.max(height, minHeight, Math.ceil(targetWidth / targetRatio));
  if (targetWidth / targetHeight > targetRatio) {
    targetHeight = Math.ceil(targetWidth / targetRatio);
  } else {
    targetWidth = Math.ceil(targetHeight * targetRatio);
  }
  const left = Math.floor((targetWidth - width) / 2);
  const right = targetWidth - width - left;
  const top = Math.floor((targetHeight - height) / 2);
  const bottom = targetHeight - height - top;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const extended = await sharp(trimmed.data)
    .extend({ top, bottom, left, right, background })
    .png()
    .toBuffer();
  const resized = await sharp(extended)
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const neutralized = await neutralizeDarkChroma(sharp, resized);
  const info = await sharp(neutralized)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return {
    path: outputPath,
    format: "png",
    dimensions: {
      width: info.width,
      height: info.height,
    },
    bytes: info.size,
    sourcePath: screenshotPath,
    crop: {
      trimmedWidth: width,
      trimmedHeight: height,
      left,
      right,
      top,
      bottom,
      maxWidth,
      maxHeight,
      resizedFrom: {
        width: targetWidth,
        height: targetHeight,
      },
    },
  };
}

export function assessBrandedMediaAsset(asset) {
  const concerns = [];
  if (!asset?.path || !fs.existsSync(asset.path)) {
    concerns.push("Branded media asset was not created.");
  }
  if (!asset?.dimensions?.width || !asset?.dimensions?.height) {
    concerns.push("Branded media asset is missing canvas dimensions.");
  } else {
    const aspectRatio = asset.dimensions.width / asset.dimensions.height;
    if (Math.abs(aspectRatio - (16 / 9)) > 0.02) {
      concerns.push("Branded media canvas is not close to a 16:9 presentation ratio.");
    }
  }
  if (asset?.layout?.titleLines > asset?.layout?.maxTitleLines) {
    concerns.push("Branded media title layout exceeds the allowed line count.");
  }
  if (asset?.layout?.subtitleLines > asset?.layout?.maxSubtitleLines) {
    concerns.push("Branded media subtitle layout exceeds the allowed line count.");
  }
  const screenshotFrame = asset?.layout?.screenshot;
  if (screenshotFrame && asset?.dimensions) {
    if (screenshotFrame.x < 0 || screenshotFrame.y < 0) {
      concerns.push("Branded media screenshot is positioned outside the canvas.");
    }
    if (screenshotFrame.x + screenshotFrame.width > asset.dimensions.width) {
      concerns.push("Branded media screenshot overflows the canvas width.");
    }
    if (screenshotFrame.y + screenshotFrame.height > asset.dimensions.height) {
      concerns.push("Branded media screenshot overflows the canvas height.");
    }
    const canvasArea = asset.dimensions.width * asset.dimensions.height;
    const screenshotArea = screenshotFrame.width * screenshotFrame.height;
    const areaRatio = canvasArea > 0 ? screenshotArea / canvasArea : 0;
    const widthRatio = asset.dimensions.width > 0 ? screenshotFrame.width / asset.dimensions.width : 0;
    const heightRatio = asset.dimensions.height > 0 ? screenshotFrame.height / asset.dimensions.height : 0;
    if (areaRatio < PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedAreaRatio) {
      concerns.push(
        `Branded media makes the product screenshot too small (${areaRatio.toFixed(2)} canvas area; minimum ${PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedAreaRatio}).`,
      );
    }
    if (widthRatio < PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedWidthRatio) {
      concerns.push(
        `Branded media product screenshot is too narrow on the card (${widthRatio.toFixed(2)} canvas width; minimum ${PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedWidthRatio}).`,
      );
    }
    if (heightRatio < PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedHeightRatio) {
      concerns.push(
        `Branded media product screenshot is too short on the card (${heightRatio.toFixed(2)} canvas height; minimum ${PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedHeightRatio}).`,
      );
    }
  }
  if (asset?.embeddedScreenshot?.width < PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedWidth || asset?.embeddedScreenshot?.height < PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedHeight) {
    concerns.push(
      `Branded media source screenshot is below production readability minimum (${asset?.embeddedScreenshot?.width || 0}x${asset?.embeddedScreenshot?.height || 0}; minimum ${PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedWidth}x${PRODUCTION_BRANDED_MEDIA_POLICY.minEmbeddedHeight}).`,
    );
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
  if (asset?.preview) {
    if (!asset.preview.path || !fs.existsSync(asset.preview.path)) {
      concerns.push("Branded media PNG preview was not created.");
    }
    if (asset.preview.format !== "png") {
      concerns.push("Branded media preview is not a PNG.");
    }
    if (asset.preview.dimensions?.width !== asset?.dimensions?.width || asset.preview.dimensions?.height !== asset?.dimensions?.height) {
      concerns.push("Branded media PNG preview dimensions do not match the SVG canvas.");
    }
  }
  return {
    ok: concerns.length === 0,
    status: concerns.length === 0 ? "accepted" : "rejected",
    concerns,
  };
}
