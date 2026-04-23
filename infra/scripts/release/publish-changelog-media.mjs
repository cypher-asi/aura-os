#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MEDIA_BEGIN_PREFIX = "<!-- AURA_CHANGELOG_MEDIA:BEGIN ";
const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_POLISH_SOURCE = "openai-polish";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }
    const key = part.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function sanitizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function isEnabled(value, defaultValue = false) {
  const normalized = sanitizeText(value).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return !["0", "false", "no", "off", "disabled"].includes(normalized);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return [...new Set(values)];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function loadFixtureCaptureResults(filePath) {
  const normalizedPath = sanitizeText(filePath);
  if (!normalizedPath) {
    return null;
  }

  const raw = readJson(path.resolve(normalizedPath));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Fixture capture results must be an object keyed by slot id: ${normalizedPath}`);
  }

  return new Map(Object.entries(raw));
}

function clipText(value, maxLength = 800) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeEnvChoice(value, fallback) {
  const normalized = sanitizeText(value);
  return normalized || fallback;
}

function evaluateWorkflowOutcome({ published = 0, failed = 0 } = {}) {
  const publishedCount = Number(published) || 0;
  const failedCount = Number(failed) || 0;

  if (failedCount > 0 && publishedCount === 0) {
    return {
      workflowOutcome: "failure",
      shouldFailWorkflow: true,
    };
  }

  if (failedCount > 0) {
    return {
      workflowOutcome: "partial",
      shouldFailWorkflow: false,
    };
  }

  return {
    workflowOutcome: "success",
    shouldFailWorkflow: false,
  };
}

function collectEntryChangedFiles(doc, entry) {
  const commitLookup = new Map((Array.isArray(doc?.rawCommits) ? doc.rawCommits : []).map((commit) => [commit.sha, commit]));
  return unique(
    (Array.isArray(entry?.items) ? entry.items : [])
      .flatMap((item) => Array.isArray(item?.commit_shas) ? item.commit_shas : [])
      .flatMap((sha) => commitLookup.get(sha)?.files || []),
  );
}

function buildRetryCorrectionGuidance(media = {}) {
  const status = sanitizeText(media?.status);
  const failureClass = sanitizeText(media?.failureClass);
  const error = clipText(media?.error || "", 220);
  if (status !== "failed" && !failureClass && !error) {
    return "";
  }

  const classGuidance = {
    quality_gate: [
      "The previous screenshot failed the quality gate.",
      "Do not stop on an empty state, generic overview, placeholder route, or loosely framed full desktop.",
      "Complete one visible correction: select a concrete row/tab/item, open the relevant detail surface, and leave the story-specific proof text centered.",
    ],
    navigation_or_timeout: [
      "The previous capture timed out or struggled with navigation.",
      "Use the shortest visible path through the launcher, taskbar, app sidebar, or labeled tabs.",
      "Avoid deep exploration; pick the first clearly relevant seeded item and stop once the proof surface is stable.",
    ],
    missing_capture_output: [
      "The previous run did not produce a usable capture summary.",
      "Keep the flow short, wait for the desktop surface to settle, and stop as soon as a valid proof screen is visible.",
    ],
    browserbase_concurrency: [
      "The previous Browserbase session was capacity-limited.",
      "Once the fresh session opens, keep the capture path short and stop at the first strong proof screen.",
    ],
    browserbase_quota: [
      "The previous provider run hit Browserbase quota limits.",
      "If this retry has a session, avoid unnecessary exploration and capture the strongest visible proof quickly.",
    ],
    openai_polish: [
      "The previous run captured a proof screenshot but failed the mandatory OpenAI branded polish stage.",
      "Capture the clearest, most readable screenshot possible so the polish stage can frame it without hiding the feature.",
      "Avoid sparse or tiny proof surfaces; keep the important UI centered and readable before polish.",
    ],
    capture_error: [
      "The previous capture hit a generic automation error.",
      "Prefer stable visible controls, avoid brittle interactions, and stop on the clearest proof screen before attempting optional refinements.",
    ],
  };

  const guidance = classGuidance[failureClass] || classGuidance.capture_error;
  return [
    "Retry correction pass:",
    failureClass ? `Previous failure class: ${failureClass}.` : "",
    error ? `Previous error summary: ${error}.` : "",
    ...guidance,
  ].filter(Boolean).join(" ");
}

function buildEntryPrompt(entry) {
  const bullets = (Array.isArray(entry?.items) ? entry.items : [])
    .map((item) => sanitizeText(item?.text))
    .filter(Boolean);
  const proofSurface = sanitizeText(entry?.media?.proofSurface);
  const captureHint = sanitizeText(entry?.media?.captureHint);
  const visibleProof = Array.isArray(entry?.media?.visibleProof)
    ? entry.media.visibleProof.map((value) => sanitizeText(value)).filter(Boolean).slice(0, 6)
    : [];
  const retryGuidance = buildRetryCorrectionGuidance(entry?.media);
  const storyParts = [
    sanitizeText(entry?.title),
    sanitizeText(entry?.summary),
    bullets.length ? `Key details: ${bullets.join(" ")}` : "",
    proofSurface ? `Expected proof surface: ${proofSurface}.` : "",
    visibleProof.length ? `Visible proof to keep on screen: ${visibleProof.join("; ")}.` : "",
    captureHint ? `Capture guidance: ${captureHint}` : "",
    retryGuidance,
    "Open the most relevant product surface for this changelog entry and leave the clearest proof visible for a polished desktop screenshot.",
    "Avoid placeholder routes, empty states, settings-only screens, and generic landing views.",
  ].filter(Boolean);

  return storyParts.join(" ");
}

function selectBestScreenshot(summary) {
  const repairPath = summary?.repair?.success && summary?.repair?.quality?.ok
    ? summary?.repair?.screenshot?.path
    : null;
  if (repairPath) {
    return {
      path: repairPath,
      source: "repair",
    };
  }

  const preferredPhases = ["capture-proof", "validate-proof", "setup-state"];
  for (const phaseId of preferredPhases) {
    const phase = (Array.isArray(summary?.phases) ? summary.phases : []).find((candidate) => candidate?.id === phaseId);
    if (phase?.success && phase?.screenshot?.path) {
      return {
        path: phase.screenshot.path,
        source: phaseId,
      };
    }
  }

  const fallbackPath = Array.isArray(summary?.screenshots)
    ? summary.screenshots.find((screenshot) => screenshot?.path)?.path
    : null;
  if (fallbackPath) {
    return {
      path: fallbackPath,
      source: "fallback",
    };
  }

  return null;
}

function buildOpenAIPolishPrompt(entry, summary) {
  const title = sanitizeText(entry?.title || summary?.storyTitle || "Aura changelog update");
  const story = clipText(summary?.story || entry?.summary || "", 900);
  return [
    "Create a premium Aura-branded abstract background for a changelog media card.",
    "The input image is a real Aura product screenshot and must be used only as visual context for palette and mood.",
    "Do not recreate, redraw, imitate, or include product UI, app chrome, readable UI text, fake screenshots, devices, people, logos, or watermarks in the generated background.",
    "Leave the composition suitable for a real screenshot to be overlaid in the center by our deterministic renderer.",
    "Keep the central field dark, quiet, and low-contrast so the real screenshot can remain the dominant element. Push any energy, grids, and orbital details toward the outer edges.",
    "Visual direction: deep black graphite base, subtle cyan/teal energy, soft glass glow, restrained grid or orbital lines, modern high-trust AI product launch feel.",
    `Changelog title: ${title}`,
    story ? `Story context: ${story}` : "",
  ].filter(Boolean).join("\n");
}

function buildOpenAIJudgePrompt(entry, summary) {
  const title = sanitizeText(entry?.title || summary?.storyTitle || "Aura changelog update");
  const proofSurface = sanitizeText(entry?.media?.proofSurface);
  const visibleProof = Array.isArray(entry?.media?.visibleProof)
    ? entry.media.visibleProof.map((value) => sanitizeText(value)).filter(Boolean).slice(0, 6)
    : [];
  return [
    "You are the final visual quality gate for Aura changelog media.",
    "Review this final branded image and return JSON only.",
    "Browserbase already validated the raw screenshot before this image was composed, but you must verify that the final branded card still preserves the proof surface.",
    "Pass only if the real product screenshot is clearly visible, readable enough for a changelog, framed professionally, and not obscured by the brand treatment.",
    "Fail if the screenshot is too small to understand, effectively unreadable, visually dominated by background, clipped at the edges, contains obvious hallucinated UI as the main proof, or loses the expected proof surface.",
    "Aura is intentionally a dark product UI; do not fail only because the interface uses a dark theme when the product context and target surface remain visible.",
    "Score must be an integer from 0 to 100, where 70 means publishable and 90 means excellent. Do not use a 0 to 10 scale.",
    `Changelog title: ${title}`,
    proofSurface ? `Expected proof surface: ${proofSurface}` : "",
    visibleProof.length ? `Expected visible proof phrases or labels: ${visibleProof.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function getOpenAIImageModel() {
  return normalizeEnvChoice(process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_MODEL, "gpt-image-2");
}

function getOpenAIImageQuality() {
  return normalizeEnvChoice(process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_QUALITY, "high");
}

function getOpenAIImageSize() {
  return normalizeEnvChoice(process.env.AURA_CHANGELOG_MEDIA_OPENAI_IMAGE_SIZE, "1536x1024");
}

function getOpenAIJudgeModel() {
  return normalizeEnvChoice(process.env.AURA_CHANGELOG_MEDIA_OPENAI_JUDGE_MODEL, "gpt-4.1-mini");
}

function getOpenAIApiKey() {
  return sanitizeText(process.env.OPENAI_API_KEY);
}

function buildOpenAIError(message, code = "OPENAI_POLISH_FAILED", details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function assertOpenAIResponseOk(response, context) {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  throw buildOpenAIError(
    `${context} failed with status ${response.status}${body ? `: ${clipText(body, 500)}` : ""}`,
    response.status === 401 || response.status === 403 ? "OPENAI_AUTH_FAILED" : "OPENAI_POLISH_FAILED",
  );
}

async function requestOpenAIBackground({ apiKey, screenshotPath, prompt }) {
  if (!apiKey) {
    throw buildOpenAIError(
      "OPENAI_API_KEY is required to generate branded changelog media.",
      "OPENAI_API_KEY_MISSING",
    );
  }

  const imageModel = getOpenAIImageModel();
  const form = new FormData();
  form.append("model", imageModel);
  form.append("prompt", prompt);
  form.append("size", getOpenAIImageSize());
  form.append("quality", getOpenAIImageQuality());
  form.append("output_format", "png");
  form.append("n", "1");
  if (imageModel === "gpt-image-1") {
    form.append("input_fidelity", "high");
  }
  form.append(
    "image",
    new Blob([fs.readFileSync(screenshotPath)], { type: "image/png" }),
    "aura-product-screenshot.png",
  );

  const response = await fetch(OPENAI_IMAGE_EDIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  await assertOpenAIResponseOk(response, "OpenAI image polish");

  const json = await response.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw buildOpenAIError("OpenAI image polish response did not include b64_json output.");
  }

  return {
    b64,
    model: sanitizeText(json?.model || imageModel),
    prompt,
  };
}

function loadPng(repoDir) {
  const requireFromInterface = createRequire(path.join(repoDir, "interface", "package.json"));
  return requireFromInterface("pngjs").PNG;
}

function roundedRectContains(x, y, width, height, radius, px, py) {
  if (px < x || py < y || px >= x + width || py >= y + height) {
    return false;
  }
  const left = x + radius;
  const right = x + width - radius - 1;
  const top = y + radius;
  const bottom = y + height - radius - 1;
  if ((px >= left && px <= right) || (py >= top && py <= bottom)) {
    return true;
  }
  const cx = px < left ? left : right;
  const cy = py < top ? top : bottom;
  const dx = px - cx;
  const dy = py - cy;
  return (dx * dx) + (dy * dy) <= radius * radius;
}

function blendPixel(image, x, y, rgba) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return;
  }
  const index = ((y * image.width) + x) * 4;
  const sourceAlpha = Math.max(0, Math.min(255, rgba[3] ?? 255)) / 255;
  const inverseAlpha = 1 - sourceAlpha;
  image.data[index] = Math.round((rgba[0] * sourceAlpha) + (image.data[index] * inverseAlpha));
  image.data[index + 1] = Math.round((rgba[1] * sourceAlpha) + (image.data[index + 1] * inverseAlpha));
  image.data[index + 2] = Math.round((rgba[2] * sourceAlpha) + (image.data[index + 2] * inverseAlpha));
  image.data[index + 3] = Math.max(image.data[index + 3], rgba[3] ?? 255);
}

function drawRoundedRect(image, x, y, width, height, radius, rgba) {
  const minX = Math.max(0, Math.floor(x));
  const minY = Math.max(0, Math.floor(y));
  const maxX = Math.min(image.width, Math.ceil(x + width));
  const maxY = Math.min(image.height, Math.ceil(y + height));
  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      if (roundedRectContains(x, y, width, height, radius, px, py)) {
        blendPixel(image, px, py, rgba);
      }
    }
  }
}

function drawRoundedImage(dest, source, x, y, width, height, radius) {
  const targetWidth = Math.max(1, Math.floor(width));
  const targetHeight = Math.max(1, Math.floor(height));
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const destX = Math.floor(x + targetX);
      const destY = Math.floor(y + targetY);
      if (!roundedRectContains(x, y, targetWidth, targetHeight, radius, destX, destY)) {
        continue;
      }
      const srcX = Math.min(source.width - 1, Math.floor((targetX / targetWidth) * source.width));
      const srcY = Math.min(source.height - 1, Math.floor((targetY / targetHeight) * source.height));
      const srcIndex = ((srcY * source.width) + srcX) * 4;
      blendPixel(dest, destX, destY, [
        source.data[srcIndex],
        source.data[srcIndex + 1],
        source.data[srcIndex + 2],
        source.data[srcIndex + 3],
      ]);
    }
  }
}

function drawFrameBorder(image, x, y, width, height, radius, rgba) {
  const outerX = x - 2;
  const outerY = y - 2;
  const outerWidth = width + 4;
  const outerHeight = height + 4;
  const outerRadius = radius + 2;
  const minX = Math.max(0, Math.floor(outerX));
  const minY = Math.max(0, Math.floor(outerY));
  const maxX = Math.min(image.width, Math.ceil(outerX + outerWidth));
  const maxY = Math.min(image.height, Math.ceil(outerY + outerHeight));
  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      if (
        roundedRectContains(outerX, outerY, outerWidth, outerHeight, outerRadius, px, py)
        && !roundedRectContains(x, y, width, height, radius, px, py)
      ) {
        blendPixel(image, px, py, rgba);
      }
    }
  }
}

function composeBrandedScreenshotCard({ repoDir, backgroundPath, screenshotPath, outputPath }) {
  const PNG = loadPng(repoDir);
  const background = PNG.sync.read(fs.readFileSync(backgroundPath));
  const screenshot = PNG.sync.read(fs.readFileSync(screenshotPath));
  const screenshotAspect = screenshot.width / Math.max(1, screenshot.height);
  const maxCardWidth = Math.min(Math.round(background.width * 0.93), 1440);
  const maxCardHeight = Math.min(Math.round(background.height * 0.8), 860);
  let cardWidth = maxCardWidth;
  let cardHeight = Math.round(cardWidth / screenshotAspect);
  if (cardHeight > maxCardHeight) {
    cardHeight = maxCardHeight;
    cardWidth = Math.round(cardHeight * screenshotAspect);
  }
  const cardX = Math.round((background.width - cardWidth) / 2);
  const cardY = Math.round((background.height - cardHeight) / 2) + Math.round(background.height * 0.02);
  const outerRadius = 28;
  const screenshotInset = Math.max(12, Math.min(18, Math.round(Math.min(cardWidth, cardHeight) * 0.018)));
  const screenshotX = cardX + screenshotInset;
  const screenshotY = cardY + screenshotInset;
  const screenshotWidth = Math.max(1, cardWidth - (screenshotInset * 2));
  const screenshotHeight = Math.max(1, cardHeight - (screenshotInset * 2));
  const screenshotRadius = Math.max(18, outerRadius - 8);

  drawRoundedRect(background, cardX - 34, cardY - 34, cardWidth + 68, cardHeight + 72, 44, [1, 8, 20, 138]);
  drawRoundedRect(background, cardX - 20, cardY - 20, cardWidth + 40, cardHeight + 42, 36, [0, 190, 255, 24]);
  drawRoundedRect(background, cardX - 12, cardY - 12, cardWidth + 24, cardHeight + 24, 32, [255, 255, 255, 20]);
  drawRoundedRect(background, cardX - 6, cardY - 6, cardWidth + 12, cardHeight + 12, 30, [2, 6, 15, 218]);
  drawRoundedRect(background, cardX, cardY, cardWidth, cardHeight, outerRadius, [4, 9, 18, 246]);
  drawRoundedRect(background, screenshotX - 1, screenshotY - 1, screenshotWidth + 2, screenshotHeight + 2, screenshotRadius + 1, [120, 228, 255, 42]);
  drawRoundedImage(background, screenshot, screenshotX, screenshotY, screenshotWidth, screenshotHeight, screenshotRadius);
  drawFrameBorder(background, screenshotX, screenshotY, screenshotWidth, screenshotHeight, screenshotRadius, [115, 226, 255, 88]);

  // Deterministic Aura accent marks. These keep branding consistent without asking
  // the image model to render text or recreate product UI.
  const accentY = Math.max(34, cardY - 54);
  for (let index = 0; index < 3; index += 1) {
    drawRoundedRect(background, cardX + (index * 22), accentY, 12, 12, 6, index === 0 ? [0, 229, 185, 220] : [90, 205, 255, 160]);
  }
  drawRoundedRect(background, cardX + 82, accentY + 4, 160, 4, 2, [130, 230, 255, 85]);

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, PNG.sync.write(background));
}

function extractOpenAIResponseText(json) {
  if (typeof json?.output_text === "string") {
    return json.output_text;
  }
  const chunks = [];
  for (const output of Array.isArray(json?.output) ? json.output : []) {
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (typeof content?.text === "string") {
        chunks.push(content.text);
      }
      if (typeof content?.output_text === "string") {
        chunks.push(content.output_text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function normalizeOpenAIJudgeScore(score) {
  const numericScore = Number(score || 0);
  if (!Number.isFinite(numericScore) || numericScore <= 0) {
    return 0;
  }
  if (numericScore <= 10) {
    return Math.round(numericScore * 10);
  }
  return Math.max(0, Math.min(100, Math.round(numericScore)));
}

async function judgePolishedImage({ apiKey, imagePath, entry, summary }) {
  const imageB64 = fs.readFileSync(imagePath).toString("base64");
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAIJudgeModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildOpenAIJudgePrompt(entry, summary),
            },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${imageB64}`,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "changelog_media_polish_judgement",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              passed: { type: "boolean" },
              proofVisible: { type: "boolean" },
              score: { type: "integer", minimum: 0, maximum: 100 },
              reasons: { type: "array", items: { type: "string" } },
              concerns: { type: "array", items: { type: "string" } },
              missingProof: { type: "array", items: { type: "string" } },
            },
            required: ["passed", "proofVisible", "score", "reasons", "concerns", "missingProof"],
          },
        },
      },
      max_output_tokens: 600,
    }),
  });
  await assertOpenAIResponseOk(response, "OpenAI branded media judge");

  const json = await response.json();
  const text = extractOpenAIResponseText(json);
  const judgement = JSON.parse(text);
  const score = normalizeOpenAIJudgeScore(judgement.score);
  return {
    passed: Boolean(judgement.passed) && Boolean(judgement.proofVisible) && score >= 70,
    score,
    reasons: Array.isArray(judgement.reasons) ? judgement.reasons.map(sanitizeText).filter(Boolean) : [],
    concerns: Array.isArray(judgement.concerns) ? judgement.concerns.map(sanitizeText).filter(Boolean) : [],
    missingProof: Array.isArray(judgement.missingProof) ? judgement.missingProof.map(sanitizeText).filter(Boolean) : [],
    proofVisible: Boolean(judgement.proofVisible),
    model: getOpenAIJudgeModel(),
  };
}

async function polishSelectedScreenshot({ repoDir, entry, summary, selectedScreenshot, slotId }) {
  const fixturePolish = summary?.polishedScreenshot;
  if (fixturePolish?.path) {
    if (!fs.existsSync(fixturePolish.path)) {
      throw buildOpenAIError(`Fixture polished screenshot does not exist: ${fixturePolish.path}`);
    }
    const fixtureJudge = fixturePolish.judge || {
      passed: true,
      proofVisible: true,
      score: fixturePolish.score ?? 100,
      reasons: ["fixture polish accepted"],
      concerns: [],
      missingProof: [],
    };
    const normalizedFixtureJudge = {
      ...fixtureJudge,
      proofVisible: fixtureJudge.proofVisible !== false,
      score: normalizeOpenAIJudgeScore(fixtureJudge.score ?? fixturePolish.score ?? 100),
      reasons: Array.isArray(fixtureJudge.reasons) ? fixtureJudge.reasons.map(sanitizeText).filter(Boolean) : [],
      concerns: Array.isArray(fixtureJudge.concerns) ? fixtureJudge.concerns.map(sanitizeText).filter(Boolean) : [],
      missingProof: Array.isArray(fixtureJudge.missingProof) ? fixtureJudge.missingProof.map(sanitizeText).filter(Boolean) : [],
    };
    if (!(Boolean(normalizedFixtureJudge.passed) && normalizedFixtureJudge.proofVisible && normalizedFixtureJudge.score >= 70)) {
      throw buildOpenAIError(
        `OpenAI branded media judge rejected ${slotId} with score ${normalizedFixtureJudge.score}: ${normalizedFixtureJudge.concerns.join("; ") || normalizedFixtureJudge.missingProof.join("; ") || "no details"}`,
        "OPENAI_POLISH_QUALITY_GATE",
        { polishJudge: normalizedFixtureJudge },
      );
    }
    return {
      path: fixturePolish.path,
      source: OPENAI_POLISH_SOURCE,
      originalScreenshotSource: selectedScreenshot.source,
      polishProvider: fixturePolish.provider || "fixture",
      polishModel: fixturePolish.model || "fixture",
      polishJudgeModel: fixturePolish.judgeModel || "fixture",
      polishScore: normalizedFixtureJudge.score,
      polishJudge: normalizedFixtureJudge,
      rawScreenshotPath: selectedScreenshot.path,
    };
  }

  const apiKey = getOpenAIApiKey();
  const polishDir = path.join(summary?.outputDir || path.dirname(selectedScreenshot.path), "openai-polish");
  ensureDir(polishDir);
  const backgroundPath = path.join(polishDir, `${slotId}-background.png`);
  const polishedPath = path.join(polishDir, `${slotId}-branded.png`);
  const prompt = buildOpenAIPolishPrompt(entry, summary);
  const background = await requestOpenAIBackground({
    apiKey,
    screenshotPath: selectedScreenshot.path,
    prompt,
  });

  fs.writeFileSync(backgroundPath, Buffer.from(background.b64, "base64"));
  composeBrandedScreenshotCard({
    repoDir,
    backgroundPath,
    screenshotPath: selectedScreenshot.path,
    outputPath: polishedPath,
  });

  const judge = await judgePolishedImage({
    apiKey,
    imagePath: polishedPath,
    entry,
    summary,
  });
  if (!judge.passed) {
    throw buildOpenAIError(
      `OpenAI branded media judge rejected ${slotId} with score ${judge.score}: ${judge.concerns.join("; ") || judge.missingProof.join("; ") || "no details"}`,
      "OPENAI_POLISH_QUALITY_GATE",
      { polishJudge: judge },
    );
  }

  return {
    path: polishedPath,
    source: OPENAI_POLISH_SOURCE,
    originalScreenshotSource: selectedScreenshot.source,
    polishProvider: "openai",
    polishModel: background.model,
    polishJudgeModel: judge.model,
    polishScore: judge.score,
    polishJudge: judge,
    rawScreenshotPath: selectedScreenshot.path,
    backgroundPath,
    prompt,
  };
}

function buildMediaMetadata(entry, assetPath, selectedScreenshot, summary) {
  return {
    slotId: entry.media.slotId,
    batchId: entry.batch_id,
    slug: entry.media.slug,
    alt: entry.media.alt,
    status: "published",
    assetPath,
    screenshotSource: selectedScreenshot.source,
    originalScreenshotSource: selectedScreenshot.originalScreenshotSource || selectedScreenshot.source,
    polishProvider: selectedScreenshot.polishProvider || "",
    polishModel: selectedScreenshot.polishModel || "",
    polishJudgeModel: selectedScreenshot.polishJudgeModel || "",
    polishScore: selectedScreenshot.polishScore ?? null,
    polishFallbackReason: sanitizeText(selectedScreenshot.polishFallbackReason || ""),
    updatedAt: new Date().toISOString(),
    storyTitle: summary?.storyTitle || entry.title,
  };
}

function mergePublishedMedia(media, metadata) {
  const next = {
    ...media,
    ...metadata,
  };
  delete next.error;
  delete next.failureClass;
  delete next.retryInstruction;
  return next;
}

function buildMediaBlock(metadata, bodyLines = []) {
  return [
    `${MEDIA_BEGIN_PREFIX}${JSON.stringify(metadata)} -->`,
    ...bodyLines,
    `<!-- AURA_CHANGELOG_MEDIA:END ${metadata.slotId} -->`,
  ].join("\n");
}

function replaceChangelogMediaBlock(markdown, metadata, bodyLines = []) {
  const pattern = new RegExp(
    `<!-- AURA_CHANGELOG_MEDIA:BEGIN [^\\n]*"slotId":"${escapeRegex(metadata.slotId)}"[^\\n]* -->[\\s\\S]*?<!-- AURA_CHANGELOG_MEDIA:END ${escapeRegex(metadata.slotId)} -->`,
  );
  const replacement = buildMediaBlock(metadata, bodyLines);
  if (!pattern.test(markdown)) {
    throw new Error(`Could not find changelog media placeholder for slot ${metadata.slotId}`);
  }
  return markdown.replace(pattern, replacement);
}

function updateEntryMedia(doc, slotId, updater) {
  return {
    ...doc,
    rendered: {
      ...doc.rendered,
      entries: (Array.isArray(doc?.rendered?.entries) ? doc.rendered.entries : []).map((entry) => {
        if (entry?.media?.slotId !== slotId) {
          return entry;
        }
        return {
          ...entry,
          media: updater(entry.media, entry),
        };
      }),
    },
  };
}

function parsePreviewHost(previewUrl) {
  const candidate = sanitizeText(previewUrl);
  if (!candidate) {
    return "";
  }

  try {
    return new URL(candidate).host;
  } catch {
    return candidate;
  }
}

function isSameReleaseDoc(a, b) {
  return sanitizeText(a?.date) === sanitizeText(b?.date)
    && sanitizeText(a?.version) === sanitizeText(b?.version)
    && sanitizeText(a?.channel) === sanitizeText(b?.channel);
}

function findHistoryJsonPathByVersion(historyDir, version) {
  if (!version || !fs.existsSync(historyDir)) {
    return null;
  }

  for (const entry of fs.readdirSync(historyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const candidatePath = path.join(historyDir, entry.name);
    const candidate = readJson(candidatePath);
    if (sanitizeText(candidate?.version) === version) {
      return candidatePath;
    }
  }

  return null;
}

function findHistoryJsonPathForRelease(historyDir, releaseDoc) {
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const versionMatch = findHistoryJsonPathByVersion(historyDir, sanitizeText(releaseDoc?.version));
  if (versionMatch) {
    return versionMatch;
  }

  const date = sanitizeText(releaseDoc?.date);
  if (!date) {
    return null;
  }

  const candidatePath = path.join(historyDir, `${date}.json`);
  if (!fs.existsSync(candidatePath)) {
    return null;
  }

  const candidate = readJson(candidatePath);
  return isSameReleaseDoc(candidate, releaseDoc) ? candidatePath : null;
}

function resolveTargetChangelogDocs(channelDir, requestedDate, requestedVersion) {
  const latestJsonPath = path.join(channelDir, "latest.json");
  const latestMarkdownPath = path.join(channelDir, "latest.md");
  const latestDoc = readJson(latestJsonPath);
  const historyDir = path.join(channelDir, "history");
  const normalizedDate = sanitizeText(requestedDate);
  const normalizedVersion = sanitizeText(requestedVersion);

  let targetJsonPath = latestJsonPath;
  if (normalizedVersion && sanitizeText(latestDoc?.version) !== normalizedVersion) {
    targetJsonPath = findHistoryJsonPathByVersion(historyDir, normalizedVersion);
    if (!targetJsonPath) {
      throw new Error(`Could not find changelog history entry for version ${normalizedVersion}`);
    }
  } else if (!normalizedVersion && normalizedDate) {
    targetJsonPath = path.join(historyDir, `${normalizedDate}.json`);
  }

  if (!fs.existsSync(targetJsonPath)) {
    throw new Error(`Could not find changelog document at ${targetJsonPath}`);
  }

  let targetDoc = targetJsonPath === latestJsonPath ? latestDoc : readJson(targetJsonPath);
  if (targetJsonPath === latestJsonPath) {
    const historyMirrorPath = findHistoryJsonPathForRelease(historyDir, latestDoc);
    if (historyMirrorPath) {
      targetJsonPath = historyMirrorPath;
      targetDoc = readJson(historyMirrorPath);
    }
  }

  const targetDate = sanitizeText(targetDoc?.date);
  const targetVersion = sanitizeText(targetDoc?.version);
  if (normalizedVersion && targetVersion !== normalizedVersion) {
    throw new Error(`Resolved changelog version ${targetVersion || "(missing)"} does not match requested version ${normalizedVersion}`);
  }
  if (normalizedDate && targetDate !== normalizedDate) {
    throw new Error(`Resolved changelog date ${targetDate || "(missing)"} does not match requested date ${normalizedDate}`);
  }
  const targetMarkdownPath = targetJsonPath === latestJsonPath
    ? latestMarkdownPath
    : path.join(historyDir, `${targetDate}.md`);

  return {
    latest: {
      doc: latestDoc,
      jsonPath: latestJsonPath,
      markdownPath: latestMarkdownPath,
    },
    target: {
      doc: targetDoc,
      jsonPath: targetJsonPath,
      markdownPath: targetMarkdownPath,
      date: targetDate,
      version: targetVersion,
      isLatest: isSameReleaseDoc(latestDoc, targetDoc),
    },
  };
}

function resolveAssetPath({ channel, version, date, slotId, sourcePath }) {
  const extension = path.extname(sourcePath) || ".png";
  return path.posix.join("assets", "changelog", channel, version || date || "latest", `${slotId}${extension}`);
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join(path.posix.sep);
}

function relativeAssetReference(markdownPath, pagesDir, assetPath) {
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  return toPosixPath(path.relative(path.dirname(markdownPath), absoluteAssetPath));
}

function isBrowserbaseConcurrencyError(output) {
  return /max concurrent sessions limit|RateLimitError|status:\s*429/i.test(String(output || ""));
}

function isBrowserbaseQuotaError(output) {
  return /status:\s*402|payment required|browser minutes limit reached|upgrade your account/i.test(String(output || ""));
}

function allowLocalFallbackOnBrowserbaseQuota() {
  return isEnabled(process.env.AURA_CHANGELOG_MEDIA_ALLOW_LOCAL_FALLBACK, true);
}

function buildAbortRemainingError(message, options = {}) {
  const error = new Error(message);
  error.abortRemaining = true;
  error.skipReason = options.skipReason || message;
  error.code = options.code || "CAPTURE_ABORT_REMAINING";
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
}

function classifyMediaFailure(error) {
  const output = [
    error?.code,
    error?.message,
    error?.captureOutput,
    error?.captureSummary?.error,
    error?.captureSummary?.reason,
  ].filter(Boolean).join("\n");

  if (error?.code === "BROWSERBASE_QUOTA_EXHAUSTED" || isBrowserbaseQuotaError(output)) {
    return "browserbase_quota";
  }
  if (/OPENAI_|OpenAI|branded media|polish/i.test(output)) {
    return "openai_polish";
  }
  if (isBrowserbaseConcurrencyError(output)) {
    return "browserbase_concurrency";
  }
  if (/did not produce a passing summary|quality|rubric|validation/i.test(output)) {
    return "quality_gate";
  }
  if (/No publishable screenshot|Could not find production-summary|summary.+missing|missing.+summary/i.test(output)) {
    return "missing_capture_output";
  }
  if (/timeout|navigation|net::|ERR_|locator|element/i.test(output)) {
    return "navigation_or_timeout";
  }

  return "capture_error";
}

function shouldFallbackToRawProof(error) {
  return error?.code === "OPENAI_POLISH_QUALITY_GATE";
}

function shouldPublishEntryMedia(entry, pagesDir, { refreshExisting = false } = {}) {
  if (!entry?.media?.requested) {
    return {
      publish: false,
      reason: "entry does not request changelog media",
    };
  }

  if (refreshExisting) {
    return {
      publish: true,
      reason: "refresh_existing requested",
    };
  }

  const status = sanitizeText(entry.media.status || "pending");
  const assetPath = sanitizeText(entry.media.assetPath);
  if (status !== "published") {
    return {
      publish: true,
      reason: `media status is ${status || "pending"}`,
    };
  }

  if (!assetPath) {
    return {
      publish: true,
      reason: "published media is missing assetPath",
    };
  }

  if (!fs.existsSync(path.join(pagesDir, assetPath))) {
    return {
      publish: true,
      reason: `asset file ${assetPath} is missing`,
    };
  }

  return {
    publish: false,
    reason: "published media asset already exists",
  };
}

function findProductionSummary(outputRoot) {
  const stack = [outputRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name === "production-summary.json") {
        return nextPath;
      }
    }
  }
  return null;
}

function runScreenshotCapture({
  repoDir,
  previewUrl,
  provider,
  channel,
  profile,
  prompt,
  changedFiles,
  slotId,
  fixtureCaptureResults,
}) {
  if (fixtureCaptureResults) {
    if (!fixtureCaptureResults.has(slotId)) {
      throw new Error(`Fixture capture result missing for ${slotId}`);
    }
    const fixture = fixtureCaptureResults.get(slotId);
    if (fixture?.error) {
      const error = new Error(String(fixture.error));
      if (fixture.summary) {
        error.captureSummary = fixture.summary;
      }
      if (fixture.outputDir) {
        error.captureRunRoot = fixture.outputDir;
      }
      throw error;
    }
    return fixture?.summary || fixture;
  }

  const interfaceDir = path.join(repoDir, "interface");
  const baseRunRoot = path.join(interfaceDir, "output", "demo-screenshots", "publish-changelog-media");
  const runStamp = `${slotId}-${Date.now()}`;

  const runCaptureAttempt = (captureProvider) => {
    const runRoot = path.join(baseRunRoot, `${runStamp}-${captureProvider}`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-changelog-media-"));
    const changedFilesPath = path.join(tempDir, "changed-files.json");
    writeJson(changedFilesPath, changedFiles);
    ensureDir(runRoot);

    const commandArgs = [
      "./scripts/produce-agent-demo-screenshots.mjs",
      "--prompt",
      prompt,
      "--channel",
      channel,
      "--base-url",
      previewUrl,
      "--provider",
      captureProvider,
      "--output-dir",
      runRoot,
      "--changed-files-file",
      changedFilesPath,
    ];

    if (profile) {
      commandArgs.push("--profile", profile);
    }

    try {
      const maxAttempts = captureProvider === "browserbase" ? 3 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          execFileSync("node", commandArgs, {
            cwd: interfaceDir,
            stdio: "pipe",
            encoding: "utf8",
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
          });
          const summaryPath = findProductionSummary(runRoot);
          if (!summaryPath) {
            throw new Error(`Could not find production-summary.json under ${runRoot}`);
          }
          return readJson(summaryPath);
        } catch (error) {
          const summaryPath = findProductionSummary(runRoot);
          if (summaryPath) {
            error.captureSummary = readJson(summaryPath);
            error.captureRunRoot = runRoot;
          }
          const output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
          const shouldRetryConcurrency = captureProvider === "browserbase"
            && isBrowserbaseConcurrencyError(output)
            && attempt < maxAttempts;
          if (!shouldRetryConcurrency) {
            error.captureProvider = captureProvider;
            error.captureOutput = output;
            throw error;
          }
          const backoffMs = attempt * 30_000;
          console.warn(`Browserbase session capacity is full. Retrying screenshot capture in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts}).`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
        }
      }
      throw new Error(`Screenshot capture attempt unexpectedly completed without producing a summary for ${captureProvider}.`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  try {
    return runCaptureAttempt(provider);
  } catch (error) {
    const output = error?.captureOutput || [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
    const isQuotaFailure = provider === "browserbase" && isBrowserbaseQuotaError(output);
    if (!isQuotaFailure) {
      throw error;
    }

    if (!allowLocalFallbackOnBrowserbaseQuota()) {
      throw buildAbortRemainingError(
        "Browserbase browser minutes are exhausted and local fallback is disabled.",
        {
          code: "BROWSERBASE_QUOTA_EXHAUSTED",
          skipReason: "Skipping remaining media captures because Browserbase browser minutes are exhausted.",
          cause: error,
        },
      );
    }

    console.warn("Browserbase browser minutes are exhausted. Falling back to the local capture provider.");

    try {
      return runCaptureAttempt("local");
    } catch (fallbackError) {
      throw buildAbortRemainingError(
        "Browserbase browser minutes are exhausted and the local capture fallback failed.",
        {
          code: "BROWSERBASE_QUOTA_EXHAUSTED",
          skipReason: "Skipping remaining media captures because Browserbase browser minutes are exhausted and the local fallback could not recover.",
          cause: fallbackError,
        },
      );
    }
  }
}

async function publishEntryMedia({
  repoDir,
  pagesDir,
  doc,
  latestMarkdownPath,
  historyMarkdownPath,
  entry,
  previewUrl,
  provider,
  profile,
  fixtureCaptureResults,
}) {
  const prompt = buildEntryPrompt(entry);
  const changedFiles = collectEntryChangedFiles(doc, entry);
  const summary = runScreenshotCapture({
    repoDir,
    previewUrl,
    provider,
    channel: doc.channel,
    profile,
    prompt,
    changedFiles,
    slotId: entry.media.slotId,
    fixtureCaptureResults,
  });

  if (!summary?.ok) {
    const error = new Error(`Screenshot capture did not produce a passing summary for ${entry.media.slotId}`);
    error.captureSummary = summary;
    throw error;
  }

  const selectedScreenshot = selectBestScreenshot(summary);
  if (!selectedScreenshot?.path || !fs.existsSync(selectedScreenshot.path)) {
    throw new Error(`No publishable screenshot was produced for ${entry.media.slotId}`);
  }
  let polishedScreenshot;
  try {
    polishedScreenshot = await polishSelectedScreenshot({
      repoDir,
      entry,
      summary,
      selectedScreenshot,
      slotId: entry.media.slotId,
    });
  } catch (error) {
    if (!shouldFallbackToRawProof(error)) {
      throw error;
    }
    polishedScreenshot = {
      ...selectedScreenshot,
      polishProvider: "openai",
      polishModel: "",
      polishJudgeModel: sanitizeText(error?.polishJudge?.model || getOpenAIJudgeModel()),
      polishScore: error?.polishJudge?.score ?? null,
      polishJudge: error?.polishJudge || null,
      polishFallbackReason: "openai_polish_quality_gate",
      originalScreenshotSource: selectedScreenshot.source,
    };
  }

  const assetPath = resolveAssetPath({
    channel: doc.channel,
    version: doc.version,
    date: doc.date,
    slotId: entry.media.slotId,
    sourcePath: polishedScreenshot.path,
  });
  const absoluteAssetPath = path.join(pagesDir, assetPath);
  ensureDir(path.dirname(absoluteAssetPath));
  fs.copyFileSync(polishedScreenshot.path, absoluteAssetPath);

  const metadata = buildMediaMetadata(entry, assetPath, polishedScreenshot, summary);
  const latestImageRef = relativeAssetReference(latestMarkdownPath, pagesDir, assetPath);
  const historyImageRef = relativeAssetReference(historyMarkdownPath, pagesDir, assetPath);

  const latestMarkdown = replaceChangelogMediaBlock(
    readText(latestMarkdownPath),
    metadata,
    [`![${metadata.alt}](${latestImageRef})`],
  );
  const historyMarkdown = replaceChangelogMediaBlock(
    readText(historyMarkdownPath),
    metadata,
    [`![${metadata.alt}](${historyImageRef})`],
  );
  writeText(latestMarkdownPath, latestMarkdown);
  writeText(historyMarkdownPath, historyMarkdown);

  return {
    metadata,
    summary,
    selectedScreenshot: polishedScreenshot,
    rawScreenshot: selectedScreenshot,
    prompt,
    changedFiles,
  };
}

function buildRunSummary(results, context = {}) {
  const publishedResults = results.filter((result) => result.status === "published");
  const failedResults = results.filter((result) => result.status === "failed");
  const skippedResults = results.filter((result) => result.status === "skipped");
  const workflow = evaluateWorkflowOutcome({
    published: publishedResults.length,
    failed: failedResults.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    channel: sanitizeText(context.channel || ""),
    version: sanitizeText(context.version || "") || null,
    date: sanitizeText(context.date || "") || null,
    provider: sanitizeText(context.provider || "") || null,
    profile: sanitizeText(context.profile || "") || null,
    previewUrl: sanitizeText(context.previewUrl || "") || null,
    previewHost: parsePreviewHost(context.previewUrl),
    abortRemainingReason: sanitizeText(context.abortRemainingReason || "") || null,
    attempted: results.length,
    published: publishedResults.length,
    failed: failedResults.length,
    skipped: skippedResults.length,
    workflowOutcome: workflow.workflowOutcome,
    shouldFailWorkflow: workflow.shouldFailWorkflow,
    strictRubricPassed: failedResults.length === 0 && !sanitizeText(context.abortRemainingReason || ""),
    publishedSlotIds: publishedResults.map((result) => result.slotId).filter(Boolean),
    failedSlotIds: failedResults.map((result) => result.slotId).filter(Boolean),
    skippedSlotIds: skippedResults.map((result) => result.slotId).filter(Boolean),
    results,
  };
}

function buildRetryPlan(summary) {
  const failedResults = Array.isArray(summary?.results)
    ? summary.results.filter((result) => result?.status === "failed")
    : [];

  return {
    generatedAt: new Date().toISOString(),
    channel: sanitizeText(summary?.channel || ""),
    version: sanitizeText(summary?.version || ""),
    date: sanitizeText(summary?.date || ""),
    provider: sanitizeText(summary?.provider || ""),
    profile: sanitizeText(summary?.profile || ""),
    previewUrl: sanitizeText(summary?.previewUrl || ""),
    previewHost: sanitizeText(summary?.previewHost || ""),
    workflowOutcome: sanitizeText(summary?.workflowOutcome || ""),
    shouldFailWorkflow: Boolean(summary?.shouldFailWorkflow),
    strictRubricPassed: Boolean(summary?.strictRubricPassed),
    failed: failedResults.length,
    failedSlots: failedResults.map((result) => ({
      slotId: sanitizeText(result?.slotId || ""),
      title: sanitizeText(result?.title || ""),
      failureClass: sanitizeText(result?.failureClass || "capture_error"),
      error: sanitizeText(result?.error || ""),
      inspectorUrl: sanitizeText(result?.inspectorUrl || ""),
      sessionId: sanitizeText(result?.sessionId || ""),
      outputDir: sanitizeText(result?.outputDir || ""),
    })),
  };
}

function buildRunSummaryMarkdown(summary) {
  const lines = [
    "## Changelog Media Diagnostics",
    "",
    `- Channel: ${summary.channel || "unknown"}`,
    `- Version: ${summary.version || "n/a"}`,
    `- Date: ${summary.date || "n/a"}`,
    `- Provider: ${summary.provider || "unknown"}`,
    `- Profile: ${summary.profile || "default"}`,
    `- Preview host: ${summary.previewHost || "n/a"}`,
    `- Attempted: ${summary.attempted}`,
    `- Published: ${summary.published}`,
    `- Failed: ${summary.failed}`,
    `- Skipped: ${summary.skipped}`,
    `- Workflow outcome: ${summary.workflowOutcome || "unknown"}`,
    `- Workflow should fail: ${summary.shouldFailWorkflow ? "yes" : "no"}`,
    `- Strict rubric passed: ${summary.strictRubricPassed ? "yes" : "no"}`,
  ];

  if (summary.abortRemainingReason) {
    lines.push(`- Abort reason: ${summary.abortRemainingReason}`);
  }

  lines.push("", "| Slot | Title | Status | Details |", "| --- | --- | --- | --- |");

  for (const result of Array.isArray(summary.results) ? summary.results : []) {
    const details = [
      result.assetPath ? `asset: ${result.assetPath}` : "",
      result.reason ? `reason: ${result.reason}` : "",
      result.polishFallbackReason ? `fallback: ${result.polishFallbackReason}` : "",
      result.failureClass ? `class: ${result.failureClass}` : "",
      result.error ? `error: ${clipText(result.error, 160)}` : "",
      result.inspectorUrl ? `inspector: ${result.inspectorUrl}` : "",
      result.sessionId ? `session: ${result.sessionId}` : "",
    ].filter(Boolean).join(" | ");
    lines.push(`| ${result.slotId || ""} | ${String(result.title || "").replace(/\|/g, "\\|")} | ${result.status || "unknown"} | ${details.replace(/\|/g, "\\|") || "n/a"} |`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function persistRunDiagnostics(baseRunRoot, summary) {
  ensureDir(baseRunRoot);
  writeJson(path.join(baseRunRoot, "publish-changelog-media-summary.json"), summary);
  writeText(path.join(baseRunRoot, "publish-changelog-media-summary.md"), buildRunSummaryMarkdown(summary));
  writeJson(path.join(baseRunRoot, "publish-changelog-media-retry.json"), buildRetryPlan(summary));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = path.resolve(args["repo-dir"] || ".");
  const pagesDir = path.resolve(args["pages-dir"] || ".");
  const channel = sanitizeText(args.channel || "nightly");
  const previewUrl = sanitizeText(args["preview-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL);
  const provider = sanitizeText(args.provider || (process.env.BROWSERBASE_API_KEY ? "browserbase" : "local")) || "local";
  const profile = sanitizeText(args.profile || "");
  const date = sanitizeText(args.date || "");
  const version = sanitizeText(args.version || "");
  const refreshExisting = args["refresh-existing"] === true;
  const fixtureCaptureResults = loadFixtureCaptureResults(args["fixture-results-file"]);

  if (!previewUrl) {
    throw new Error("A preview URL is required. Pass --preview-url or set AURA_DEMO_SCREENSHOT_BASE_URL.");
  }

  const channelDir = path.join(pagesDir, "changelog", channel);
  const changelogDocs = resolveTargetChangelogDocs(channelDir, date, version);
  const effectiveDate = changelogDocs.target.date;
  const effectiveVersion = changelogDocs.target.version;
  const diagnosticsRoot = path.join(repoDir, "interface", "output", "demo-screenshots", "publish-changelog-media");
  let targetDoc = changelogDocs.target.doc;
  let latestDoc = changelogDocs.latest.doc;
  const candidateEntries = Array.isArray(targetDoc?.rendered?.entries) ? targetDoc.rendered.entries : [];
  const willAttemptMedia = candidateEntries.some((entry) =>
    shouldPublishEntryMedia(entry, pagesDir, { refreshExisting }).publish
  );
  if (willAttemptMedia && !fixtureCaptureResults && !getOpenAIApiKey()) {
    throw buildOpenAIError(
      "OPENAI_API_KEY is required because changelog media publishing now always produces branded OpenAI-polished assets.",
      "OPENAI_API_KEY_MISSING",
    );
  }

  const results = [];
  let abortRemainingReason = null;
  for (const entry of candidateEntries) {
    if (abortRemainingReason) {
      results.push({
        slotId: entry?.media?.slotId || entry?.batch_id || entry?.title || "entry",
        title: entry?.title || "Untitled entry",
        status: "skipped",
        reason: abortRemainingReason,
      });
      continue;
    }

    const decision = shouldPublishEntryMedia(entry, pagesDir, { refreshExisting });
    if (!decision.publish) {
      results.push({
        slotId: entry?.media?.slotId || entry?.batch_id || entry?.title || "entry",
        title: entry?.title || "Untitled entry",
        status: "skipped",
        reason: decision.reason,
      });
      continue;
    }

    try {
      const published = await publishEntryMedia({
        repoDir,
        pagesDir,
        doc: targetDoc,
        latestMarkdownPath: changelogDocs.target.isLatest ? changelogDocs.latest.markdownPath : changelogDocs.target.markdownPath,
        historyMarkdownPath: changelogDocs.target.markdownPath,
        entry,
        previewUrl,
        provider,
        profile,
        fixtureCaptureResults,
      });

      targetDoc = updateEntryMedia(targetDoc, entry.media.slotId, (media) =>
        mergePublishedMedia(media, published.metadata)
      );
      if (changelogDocs.target.isLatest) {
        latestDoc = targetDoc;
      } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
        latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) =>
          mergePublishedMedia(media, published.metadata)
        );
      }

      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "published",
        assetPath: published.metadata.assetPath,
        screenshotSource: published.selectedScreenshot.source,
        originalScreenshotSource: published.selectedScreenshot.originalScreenshotSource || published.rawScreenshot?.source || null,
        polishProvider: published.selectedScreenshot.polishProvider || null,
        polishModel: published.selectedScreenshot.polishModel || null,
        polishJudgeModel: published.selectedScreenshot.polishJudgeModel || null,
        polishScore: published.selectedScreenshot.polishScore ?? null,
        polishFallbackReason: published.selectedScreenshot.polishFallbackReason || null,
        outputDir: published.summary?.outputDir || null,
        inspectorUrl: published.summary?.inspectorUrl || null,
        sessionId: published.summary?.sessionId || null,
      });
    } catch (error) {
      const failureClass = classifyMediaFailure(error);
      const retryInstruction = buildRetryCorrectionGuidance({
        status: "failed",
        failureClass,
        error: String(error),
      });
      targetDoc = updateEntryMedia(targetDoc, entry.media.slotId, (media) => ({
        ...media,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: String(error),
        failureClass,
        retryInstruction,
      }));
      if (changelogDocs.target.isLatest) {
        latestDoc = targetDoc;
      } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
        latestDoc = updateEntryMedia(latestDoc, entry.media.slotId, (media) => ({
          ...media,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: String(error),
          failureClass,
          retryInstruction,
        }));
      }
      results.push({
        slotId: entry.media.slotId,
        title: entry.title,
        status: "failed",
        failureClass,
        error: String(error),
        outputDir: error?.captureSummary?.outputDir || error?.captureRunRoot || null,
        inspectorUrl: error?.captureSummary?.inspectorUrl || null,
        sessionId: error?.captureSummary?.sessionId || null,
        captureOutput: clipText(error?.captureOutput || "", 1200) || null,
      });

      if (error?.abortRemaining) {
        abortRemainingReason = error.skipReason || "Skipping remaining media captures after an unrecoverable provider failure.";
      }
    }
  }

  writeJson(changelogDocs.target.jsonPath, targetDoc);
  if (changelogDocs.target.isLatest) {
    writeJson(changelogDocs.latest.jsonPath, targetDoc);
  } else if (isSameReleaseDoc(latestDoc, targetDoc)) {
    writeJson(changelogDocs.latest.jsonPath, latestDoc);
  }

  const summary = buildRunSummary(results, {
    channel,
    date: effectiveDate,
    version: effectiveVersion,
    provider,
    profile,
    previewUrl,
    abortRemainingReason,
  });
  persistRunDiagnostics(diagnosticsRoot, summary);
  console.log(JSON.stringify({
    ...summary,
  }, null, 2));

  if (summary.shouldFailWorkflow) {
    process.exitCode = 1;
  }
}

export {
  allowLocalFallbackOnBrowserbaseQuota,
  buildEntryPrompt,
  evaluateWorkflowOutcome,
  buildAbortRemainingError,
  buildRetryCorrectionGuidance,
  classifyMediaFailure,
  buildMediaBlock,
  composeBrandedScreenshotCard,
  buildRetryPlan,
  buildRunSummaryMarkdown,
  buildRunSummary,
  isBrowserbaseConcurrencyError,
  isBrowserbaseQuotaError,
  isEnabled,
  loadFixtureCaptureResults,
  mergePublishedMedia,
  normalizeOpenAIJudgeScore,
  parseArgs,
  resolveTargetChangelogDocs,
  replaceChangelogMediaBlock,
  resolveAssetPath,
  selectBestScreenshot,
  shouldPublishEntryMedia,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
