import fs from "node:fs";

import { PNG } from "pngjs";

const BAD_PROOF_PATTERNS = [
  /\b(?:404|not found|error page)\b/i,
  /\b(?:login|log in|sign in|auth(?:entication)? required)\s+(?:screen|page|form|wall|required|needed)\b/i,
  /\b(?:loading|spinner)\s+(?:screen|page|state|indicator)\b/i,
  /\b(?:placeholder|empty)\s+(?:screen|page|state)\b/i,
  /\b(?:will appear here|pick a project|select a run|select an? .+ to see details|no (?:runs|items|results|projects|images|models) found)\b/i,
  /\b(?:mobile|ios|android|hamburger|bottom nav)\s+(?:layout|ui|screen|navigation|surface)\b/i,
];

export const PRODUCTION_MEDIA_QUALITY_POLICY = Object.freeze({
  minRawWidth: 1920,
  minRawHeight: 1080,
  minRawPixels: 1920 * 1080,
  minRawVisionScore: 0.75,
  minBrandedVisionScore: 0.75,
});
const OPENAI_VISION_QUALITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "score", "reasons", "visibleProof", "rejectionCategory"],
  properties: {
    pass: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 1 },
    reasons: { type: "array", items: { type: "string" } },
    visibleProof: { type: "array", items: { type: "string" } },
    rejectionCategory: {
      type: ["string", "null"],
      enum: [
        "wrong-screen",
        "login-or-auth",
        "mobile-layout",
        "loading-or-empty",
        "unreadable",
        "clipped",
        "not-visual",
        "other",
        null,
      ],
    },
  },
};

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join("\n");
  }
  return String(value || "").trim();
}

function parseBrowserUseOutput(output) {
  if (output && typeof output === "object") return output;
  const body = String(output || "").trim();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    const match = body.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function measurePngQuality(buffer, { sampleLimit = 12000 } = {}) {
  try {
    const png = PNG.sync.read(buffer);
    const pixelCount = png.width * png.height;
    const stride = Math.max(1, Math.floor(pixelCount / sampleLimit));
    let samples = 0;
    let sum = 0;
    let sumSquares = 0;
    let opaqueSamples = 0;
    let edgeChecks = 0;
    let edges = 0;
    let previousLuma = null;

    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      samples += 1;
      sum += luma;
      sumSquares += luma * luma;
      if (alpha > 16) opaqueSamples += 1;
      if (previousLuma !== null) {
        edgeChecks += 1;
        if (Math.abs(luma - previousLuma) > 22) edges += 1;
      }
      previousLuma = luma;
    }

    const mean = samples > 0 ? sum / samples : 0;
    const variance = samples > 0 ? Math.max(0, (sumSquares / samples) - (mean * mean)) : 0;

    return {
      ok: true,
      width: png.width,
      height: png.height,
      samples,
      lumaMean: Number(mean.toFixed(2)),
      lumaStdDev: Number(Math.sqrt(variance).toFixed(2)),
      edgeDensity: Number((edgeChecks > 0 ? edges / edgeChecks : 0).toFixed(4)),
      opaqueRatio: Number((samples > 0 ? opaqueSamples / samples : 0).toFixed(4)),
      visuallySparse: Math.sqrt(variance) < 8 && (edgeChecks > 0 ? edges / edgeChecks : 0) < 0.01,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readScreenshotMetrics(screenshot) {
  const concerns = [];
  if (!screenshot?.path) {
    return {
      concerns: ["No screenshot file was provided to the quality gate."],
      metrics: null,
    };
  }
  if (!fs.existsSync(screenshot.path)) {
    return {
      concerns: [`Screenshot file does not exist: ${screenshot.path}`],
      metrics: null,
    };
  }
  const buffer = fs.readFileSync(screenshot.path);
  const metrics = measurePngQuality(buffer);
  if (!metrics.ok) {
    concerns.push(`Screenshot PNG could not be decoded: ${metrics.error}`);
    return { concerns, metrics };
  }
  if (metrics.opaqueRatio < 0.98) {
    concerns.push(`Screenshot has too many transparent pixels (${metrics.opaqueRatio}); expected an opaque browser capture.`);
  }
  return { concerns, metrics };
}

export function assessChangelogMediaQuality({
  desktopEvaluation,
  output,
  screenshot,
  candidate = null,
  stage = "raw",
} = {}) {
  const parsedOutput = desktopEvaluation?.parsedOutput || parseBrowserUseOutput(output);
  const concerns = [...new Set(desktopEvaluation?.concerns || [])];
  const { concerns: screenshotConcerns, metrics } = readScreenshotMetrics(screenshot);
  concerns.push(...screenshotConcerns);
  if (metrics?.ok) {
    if (metrics.width < PRODUCTION_MEDIA_QUALITY_POLICY.minRawWidth || metrics.height < PRODUCTION_MEDIA_QUALITY_POLICY.minRawHeight) {
      concerns.push(
        `Screenshot is below production readability minimum (${metrics.width}x${metrics.height}; minimum ${PRODUCTION_MEDIA_QUALITY_POLICY.minRawWidth}x${PRODUCTION_MEDIA_QUALITY_POLICY.minRawHeight}).`,
      );
    }
    if ((metrics.width * metrics.height) < PRODUCTION_MEDIA_QUALITY_POLICY.minRawPixels) {
      concerns.push(
        `Screenshot has too few source pixels for readable changelog media (${metrics.width * metrics.height}; minimum ${PRODUCTION_MEDIA_QUALITY_POLICY.minRawPixels}).`,
      );
    }
  }

  const evidenceText = normalizeText([
    parsedOutput?.screenshotDescription,
    parsedOutput?.visibleProof,
    parsedOutput?.concerns,
  ]);
  const hasConcreteProofText = Array.isArray(parsedOutput?.visibleProof) && parsedOutput.visibleProof.length > 0;
  if (metrics?.visuallySparse) {
    concerns.push("Screenshot appears mostly blank or visually flat.");
  }
  if (BAD_PROOF_PATTERNS.some((pattern) => pattern.test(evidenceText))) {
    concerns.push("Browser proof text mentions login, loading, error, mobile, or placeholder UI.");
  }

  if (parsedOutput?.shouldCapture !== true) {
    concerns.push("Browser Use did not mark this as a screenshot-worthy capture.");
  }
  if (parsedOutput?.proofVisible !== true) {
    concerns.push("Browser Use did not confirm visible proof.");
  }
  if (!Array.isArray(parsedOutput?.visibleProof) || parsedOutput.visibleProof.length === 0) {
    concerns.push("Browser Use did not provide concrete visible proof bullets.");
  }

  const expectedAppId = String(candidate?.targetAppId || "").trim();
  const reportedAppId = String(parsedOutput?.targetAppId || "").trim();
  if (expectedAppId && reportedAppId && expectedAppId !== reportedAppId) {
    concerns.push(`Browser Use reported target app ${reportedAppId}, expected ${expectedAppId}.`);
  }

  const expectedPath = String(candidate?.targetPath || "").trim();
  const reportedPath = String(parsedOutput?.targetPath || "").trim();
  if (expectedPath && reportedPath && !reportedPath.startsWith(expectedPath)) {
    concerns.push(`Browser Use reported target path ${reportedPath}, expected ${expectedPath}.`);
  }

  const ok = Boolean(
    desktopEvaluation?.ok
      && metrics?.ok
      && concerns.length === 0,
  );

  return {
    ok,
    stage,
    status: ok ? "accepted" : "rejected",
    metrics,
    parsedOutput,
    concerns: [...new Set(concerns)],
  };
}

export function buildVisionJudgePrompt({ candidate, stage = "raw" } = {}) {
  const isRawStage = stage === "raw";
  return [
    "You are the independent quality judge for an Aura changelog media asset.",
    "",
    isRawStage
      ? "Judge the attached raw capture strictly for product proof, not final marketing composition."
      : "Judge the attached branded image strictly as the final public changelog media asset.",
    "",
    "Candidate:",
    JSON.stringify({
      entryId: candidate?.entryId || null,
      title: candidate?.title || null,
      proofGoal: candidate?.proofGoal || null,
      targetAppId: candidate?.targetAppId || null,
      targetPath: candidate?.targetPath || null,
      stage,
    }, null, 2),
    "",
    "Pass only if all are true:",
    "- It shows desktop Aura product UI, not mobile UI.",
    "- It is not a login, loading, placeholder, empty, or error page.",
    "- The screenshot visibly proves the changelog entry.",
    "- Reject soft, compressed, pixelated, tiny, or low-resolution product UI even when the right screen is technically visible.",
    "- Nothing important is clipped.",
    ...(isRawStage
      ? [
        "- For raw captures, pass a utilitarian crop if the relevant product proof is crisp, readable, and correct.",
        "- For raw captures, do not reject merely because the app has dark/empty surrounding space; composition is handled by the branded stage.",
        "- For raw captures, the primary proof must still be large enough to verify without ambiguity.",
        "- Focused controls, menus, and dropdowns can pass without a global app header when the specific proof and its local product context are visible; route/app identity is separately verified by deterministic gates.",
      ]
      : [
        "- Text and important UI are crisp and readable at normal changelog display size, without opening the full-size image.",
        "- The primary proof for the claim is easy to find without zooming or hunting around the image.",
        "- Aura uses a dark, spacious desktop UI; do not reject solely for dark negative space when the feature proof is large, crisp, and intentional.",
        "- Focused control/menu captures are acceptable when the title/caption provide context and the product pixels clearly prove the change.",
        "- For compact controls, menus, dropdowns, pickers, or popovers, pass when the changed label/control is crisp and the nearby selected control or local UI context makes the product surface understandable.",
        "- Do not require compact control/menu proof to fill most of the canvas or show the global app header; route and app identity are checked separately.",
        "- For branded assets, the real product screenshot remains clear, unaltered, and large enough for the primary proof to be read comfortably.",
        "- For branded assets, title/caption copy is public-facing and does not read like an internal instruction.",
        "- Reject branded assets only when branding makes the actual proof unreadable, clipped, misleading, or obviously incidental.",
      ]),
    "",
    "If pass is true and the image has no severe quality issue, choose a score at or above the required passing threshold.",
    "",
    "Return strict JSON with: pass, score, reasons, visibleProof, rejectionCategory.",
  ].join("\n");
}

function mediaTypeForImagePath(imagePath) {
  if (/\.jpe?g$/i.test(imagePath)) return "image/jpeg";
  if (/\.webp$/i.test(imagePath)) return "image/webp";
  return "image/png";
}

function parseOpenAITextResponse(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
      if (typeof part?.output_text === "string" && part.output_text.trim()) return part.output_text.trim();
    }
  }
  return "";
}

function parseOpenAIVisionResponse(payload) {
  const text = parseOpenAITextResponse(payload);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function evaluateVisionJudgment(judgment, { stage = "raw" } = {}) {
  const reasons = Array.isArray(judgment?.reasons)
    ? judgment.reasons.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const visibleProof = Array.isArray(judgment?.visibleProof)
    ? judgment.visibleProof.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const score = Number(judgment?.score);
  const minimumScore = stage === "raw"
    ? PRODUCTION_MEDIA_QUALITY_POLICY.minRawVisionScore
    : PRODUCTION_MEDIA_QUALITY_POLICY.minBrandedVisionScore;
  const rejectionCategory = judgment?.rejectionCategory ?? null;
  const ok = Boolean(
    judgment?.pass === true
      && score >= minimumScore
      && visibleProof.length > 0
      && rejectionCategory === null,
  );
  const concerns = [];
  if (judgment?.pass !== true) concerns.push("Vision judge rejected the image.");
  if (!Number.isFinite(score) || score < minimumScore) {
    concerns.push(`Vision judge score is too low (${Number.isFinite(score) ? score : "missing"}; minimum ${minimumScore}).`);
  }
  if (visibleProof.length === 0) concerns.push("Vision judge did not provide visible proof.");
  if (rejectionCategory !== null) concerns.push(`Vision judge reported rejection category: ${rejectionCategory}.`);

  return {
    ok,
    status: ok ? "accepted" : "rejected",
    concerns,
    judgment: {
      pass: judgment?.pass === true,
      score: Number.isFinite(score) ? score : null,
      reasons,
      visibleProof,
      rejectionCategory,
    },
  };
}

export async function judgeChangelogMediaWithOpenAI({
  apiKey,
  model = "gpt-5.2",
  imagePath,
  candidate,
  stage = "raw",
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      status: "failed",
      concerns: ["OPENAI_API_KEY is required for the vision quality judge."],
      judgment: null,
    };
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    return {
      ok: false,
      status: "failed",
      concerns: ["Vision quality judge image is missing."],
      judgment: null,
    };
  }

  const mediaType = mediaTypeForImagePath(imagePath);
  const imageUrl = `data:${mediaType};base64,${fs.readFileSync(imagePath).toString("base64")}`;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildVisionJudgePrompt({ candidate, stage }),
            },
            {
              type: "input_image",
              image_url: imageUrl,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "changelog_media_quality",
          strict: true,
          schema: OPENAI_VISION_QUALITY_SCHEMA,
        },
      },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      concerns: [`OpenAI vision quality judge failed with HTTP ${response.status}: ${body.slice(0, 300)}`],
      judgment: null,
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      ok: false,
      status: "failed",
      concerns: ["OpenAI vision quality judge returned invalid JSON."],
      judgment: null,
    };
  }

  const judgment = parseOpenAIVisionResponse(payload);
  if (!judgment) {
    return {
      ok: false,
      status: "failed",
      concerns: ["OpenAI vision quality judge did not return a JSON judgment."],
      judgment: null,
    };
  }

  return evaluateVisionJudgment(judgment, { stage });
}
