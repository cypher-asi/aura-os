import fs from "node:fs";
import path from "node:path";

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

function mediaTypeForImagePath(imagePath) {
  if (/\.jpe?g$/i.test(imagePath)) return "image/jpeg";
  if (/\.webp$/i.test(imagePath)) return "image/webp";
  return "image/png";
}

const PRODUCTION_BRANDED_MEDIA_POLICY = Object.freeze({
  minEmbeddedWidth: 1920,
  minEmbeddedHeight: 1080,
  minEmbeddedAreaRatio: 0.5,
  minEmbeddedWidthRatio: 0.72,
  minEmbeddedHeightRatio: 0.48,
});

function parseOpenAIImagePayload(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first || typeof first !== "object") return null;
  return first.b64_json || first.image_base64 || first.image?.b64_json || null;
}

function buildOpenAIProductionRedrawPrompt({ candidate, rawVisionGate } = {}) {
  const rawReasons = Array.isArray(rawVisionGate?.judgment?.reasons)
    ? rawVisionGate.judgment.reasons.slice(0, 4)
    : [];
  return [
    "Create a production-grade Aura changelog image from the attached product screenshot by restoring clarity while staying product-faithful.",
    "",
    "Non-negotiable fidelity rules:",
    "- Preserve the same Aura app, dark desktop shell, layout structure, navigation, panels, selected app state, and product content from the reference screenshot.",
    "- Preserve visible app text faithfully and make it fully legible; do not abbreviate, garble, crop, or partially hide labels.",
    "- Preserve the exact count, position, size relationship, and shape language of visible navigation controls, side panels, taskbar capsules, icons, tabs, thumbnails, and input fields.",
    "- If a non-essential edge label is visibly clipped in the reference, repair only the obvious clipping when certain; otherwise omit or de-emphasize that edge text rather than guessing.",
    "- Do not invent new features, new controls, fake metrics, different product names, or unrelated UI.",
    "- Do not make subtle proof elements more prominent than they are in the source; improve clarity without exaggerating, redesigning, reframing, or adding glass/chrome.",
    "- Do not add marketing text, badges, captions, labels, watermarks, or a title outside the app UI.",
    "- Keep the Aura design language: dark spacious interface, glassy panels, subtle borders, rounded chrome, crisp white/gray typography.",
    "",
    "Quality goals:",
    "- Restore the screenshot with more finesse, contrast, and crispness while staying faithful to the app.",
    "- Make UI text and important controls readable at changelog-card size.",
    "- Keep the same product framing unless the reference is clearly unusable; for shell/layout proof, preserve the full desktop frame including sidebar, main panel, side panel, and bottom taskbar.",
    "- Improve contrast and edge clarity without changing the actual product state.",
    "- Output a clean 16:9 desktop image.",
    "",
    "Changelog proof target:",
    JSON.stringify({
      title: candidate?.title || null,
      proofGoal: candidate?.proofGoal || null,
      targetAppId: candidate?.targetAppId || null,
      targetPath: candidate?.targetPath || null,
      rawVisionFeedback: rawReasons,
    }, null, 2),
  ].join("\n");
}

export async function createOpenAIProductionMediaImage({
  apiKey,
  model = "gpt-image-2",
  inputImagePath,
  outputPath,
  candidate,
  rawVisionGate = null,
  quality = "high",
  size = "2560x1440",
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    return {
      status: "blocked",
      reason: "OPENAI_API_KEY is required for production image generation.",
    };
  }
  if (!inputImagePath || !fs.existsSync(inputImagePath)) {
    return {
      status: "blocked",
      reason: "A source screenshot is required for production image generation.",
    };
  }
  if (!outputPath) {
    throw new Error("outputPath is required.");
  }

  const imageBuffer = fs.readFileSync(inputImagePath);
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", buildOpenAIProductionRedrawPrompt({ candidate, rawVisionGate }));
  form.append("quality", quality);
  form.append("size", size);
  form.append(
    "image",
    new Blob([imageBuffer], { type: mediaTypeForImagePath(inputImagePath) }),
    path.basename(inputImagePath),
  );

  const response = await fetchImpl("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const body = await response.text();
  if (!response.ok) {
    return {
      status: "failed",
      reason: `OpenAI production image generation failed with HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      status: "failed",
      reason: "OpenAI production image generation returned invalid JSON.",
    };
  }

  const b64 = parseOpenAIImagePayload(payload);
  if (!b64) {
    return {
      status: "failed",
      reason: "OpenAI production image generation did not return image bytes.",
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
  const dimensions = readPngDimensionsFromFile(outputPath);
  const sourceDimensions = readPngDimensionsFromFile(inputImagePath);
  return {
    status: "created",
    reason: "Created an OpenAI production redraw from the accepted raw product screenshot.",
    asset: {
      path: outputPath,
      format: "png",
      dimensions: {
        width: dimensions.width,
        height: dimensions.height,
      },
      bytes: dimensions.bytes,
      layout: {
        aspectRatio: dimensions.width / dimensions.height,
        labelLines: 0,
        titleLines: 0,
        subtitleLines: 0,
        maxTitleLines: 0,
        maxSubtitleLines: 0,
        screenshot: {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: dimensions.height,
        },
      },
      embeddedScreenshot: {
        path: inputImagePath,
        width: sourceDimensions.width,
        height: sourceDimensions.height,
        bytes: sourceDimensions.bytes,
        renderedWidth: sourceDimensions.width,
        renderedHeight: sourceDimensions.height,
        scale: 1,
        treatment: "openai-production-redraw",
      },
      preview: {
        path: outputPath,
        format: "png",
        dimensions: {
          width: dimensions.width,
          height: dimensions.height,
        },
        bytes: dimensions.bytes,
      },
      generation: {
        provider: "openai",
        model,
        quality,
        size,
      },
    },
  };
}

export function createPixelPreservedProductionMediaImage({
  inputImagePath,
  outputPath,
  reason = "Created a pixel-preserved production proof from the accepted raw product screenshot.",
} = {}) {
  if (!inputImagePath || !fs.existsSync(inputImagePath)) {
    return {
      status: "blocked",
      reason: "A source screenshot is required for pixel-preserved production media.",
    };
  }
  if (!outputPath) {
    throw new Error("outputPath is required.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(inputImagePath, outputPath);
  const dimensions = readPngDimensionsFromFile(outputPath);
  const sourceDimensions = readPngDimensionsFromFile(inputImagePath);
  return {
    status: "created",
    reason,
    asset: {
      path: outputPath,
      format: "png",
      dimensions: {
        width: dimensions.width,
        height: dimensions.height,
      },
      bytes: dimensions.bytes,
      layout: {
        aspectRatio: dimensions.width / dimensions.height,
        labelLines: 0,
        titleLines: 0,
        subtitleLines: 0,
        maxTitleLines: 0,
        maxSubtitleLines: 0,
        screenshot: {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: dimensions.height,
        },
      },
      embeddedScreenshot: {
        path: inputImagePath,
        width: sourceDimensions.width,
        height: sourceDimensions.height,
        bytes: sourceDimensions.bytes,
        renderedWidth: sourceDimensions.width,
        renderedHeight: sourceDimensions.height,
        scale: 1,
        treatment: "pixel-preserved-production-proof",
      },
      preview: {
        path: outputPath,
        format: "png",
        dimensions: {
          width: dimensions.width,
          height: dimensions.height,
        },
        bytes: dimensions.bytes,
      },
      treatment: "pixel-preserved-production-proof",
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
      concerns.push("Branded media PNG preview dimensions do not match the media canvas.");
    }
  }
  return {
    ok: concerns.length === 0,
    status: concerns.length === 0 ? "accepted" : "rejected",
    concerns,
  };
}
