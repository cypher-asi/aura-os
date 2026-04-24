import fs from "node:fs";

import { PNG } from "pngjs";

const BAD_PROOF_PATTERN = /\b(?:404|not found|login|log in|sign in|auth(?:entication)? required|loading|spinner|placeholder|empty state|error page|mobile|ios|android|hamburger|bottom nav)\b/i;
const VISION_QUALITY_TOOL = {
  name: "submit_changelog_media_quality",
  description: "Submit a strict quality judgment for an Aura changelog media image.",
  input_schema: {
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
  if (metrics.lumaStdDev < 8 && metrics.edgeDensity < 0.01) {
    concerns.push("Screenshot appears mostly blank or visually flat.");
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

  const evidenceText = normalizeText([
    parsedOutput?.screenshotDescription,
    parsedOutput?.visibleProof,
    parsedOutput?.concerns,
  ]);
  if (BAD_PROOF_PATTERN.test(evidenceText)) {
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
  return [
    "You are the independent quality judge for an Aura changelog media asset.",
    "",
    "Judge the attached image strictly. Do not reward pretty branding if the product proof is weak.",
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
    "- Text and important UI are readable at normal changelog display size.",
    "- Nothing important is clipped.",
    "- For branded assets, the real product screenshot remains clear and unaltered.",
    "",
    "Return strict JSON with: pass, score, reasons, visibleProof, rejectionCategory.",
  ].join("\n");
}

function mediaTypeForImagePath(imagePath) {
  if (/\.jpe?g$/i.test(imagePath)) return "image/jpeg";
  if (/\.webp$/i.test(imagePath)) return "image/webp";
  return "image/png";
}

function parseVisionToolResponse(payload) {
  const toolUse = (Array.isArray(payload?.content) ? payload.content : [])
    .find((entry) => entry?.type === "tool_use" && entry?.name === VISION_QUALITY_TOOL.name);
  if (toolUse?.input && typeof toolUse.input === "object") {
    return toolUse.input;
  }
  return null;
}

export async function judgeChangelogMediaWithAnthropic({
  apiKey,
  model = "claude-opus-4-7",
  imagePath,
  candidate,
  stage = "raw",
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      status: "failed",
      concerns: ["ANTHROPIC_API_KEY is required for the vision quality judge."],
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

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      tools: [VISION_QUALITY_TOOL],
      tool_choice: { type: "tool", name: VISION_QUALITY_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVisionJudgePrompt({ candidate, stage }),
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaTypeForImagePath(imagePath),
                data: fs.readFileSync(imagePath).toString("base64"),
              },
            },
          ],
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      concerns: [`Anthropic vision quality judge failed with HTTP ${response.status}: ${body.slice(0, 300)}`],
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
      concerns: ["Anthropic vision quality judge returned invalid JSON."],
      judgment: null,
    };
  }

  const judgment = parseVisionToolResponse(payload);
  if (!judgment) {
    return {
      ok: false,
      status: "failed",
      concerns: ["Anthropic vision quality judge did not return a tool judgment."],
      judgment: null,
    };
  }

  const reasons = Array.isArray(judgment.reasons)
    ? judgment.reasons.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const visibleProof = Array.isArray(judgment.visibleProof)
    ? judgment.visibleProof.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const score = Number(judgment.score);
  const ok = Boolean(judgment.pass === true && score >= 0.72 && visibleProof.length > 0);
  const concerns = [];
  if (judgment.pass !== true) concerns.push("Vision judge rejected the image.");
  if (!Number.isFinite(score) || score < 0.72) concerns.push(`Vision judge score is too low (${Number.isFinite(score) ? score : "missing"}).`);
  if (visibleProof.length === 0) concerns.push("Vision judge did not provide visible proof.");

  return {
    ok,
    status: ok ? "accepted" : "rejected",
    concerns,
    judgment: {
      pass: judgment.pass === true,
      score: Number.isFinite(score) ? score : null,
      reasons,
      visibleProof,
      rejectionCategory: judgment.rejectionCategory ?? null,
    },
  };
}
