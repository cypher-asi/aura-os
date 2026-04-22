#!/usr/bin/env node

import path from "node:path";
import { promises as fs } from "node:fs";

import { chromium } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";

import { loadDemoScreenshotChangelog } from "./lib/demo-screenshot-changelog.mjs";
import { buildDemoAgentBrief } from "./lib/demo-agent-brief.mjs";
import {
  applyDemoSeedPatch,
  getDemoScreenshotProfile,
} from "./lib/demo-screenshot-seeds.mjs";
import { applyDemoSeedPlanToBrief, buildDemoSeedPlan } from "./lib/demo-seed-planner.mjs";
import { installBootAuth, installSeedRoutes } from "./lib/demo-browser-seed.mjs";
import { assessDemoScreenshotQuality } from "./lib/demo-screenshot-quality.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) {
      index += 1;
    }

    if (key in args) {
      const existing = args[key];
      args[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      continue;
    }
    args[key] = value;
  }
  return args;
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry || "").split(",")).map((entry) => entry.trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveStagehandCacheMode(value) {
  const normalized = String(value || "run").trim().toLowerCase();
  if (["off", "none", "disabled", "false", "0"].includes(normalized)) {
    return "off";
  }
  if (["persistent", "shared", "always", "true", "1"].includes(normalized)) {
    return "persistent";
  }
  return "run";
}

function resolveStagehandCacheDir({ cacheMode, provider, targetAppId, runId }) {
  if (cacheMode === "off") {
    return null;
  }

  const root = path.join(process.cwd(), "output", ".stagehand-cache", provider);
  if (cacheMode === "persistent") {
    return path.join(root, targetAppId || "general");
  }

  return path.join(root, "runs", runId);
}

function resolveExcludedAgentTools(args) {
  const excluded = new Set(normalizeArray(args["exclude-agent-tool"] || process.env.AURA_DEMO_AGENT_EXCLUDE_TOOLS));
  const allowGoto = isEnabled(args["allow-agent-goto"] || process.env.AURA_DEMO_AGENT_ALLOW_GOTO);

  if (!allowGoto) {
    excluded.add("goto");
  }

  return Array.from(excluded).sort();
}

function normalizeStagehandLogLine(logLine) {
  return {
    timestamp: logLine?.timestamp || new Date().toISOString(),
    category: logLine?.category || "general",
    level: logLine?.level ?? 1,
    message: String(logLine?.message || ""),
    auxiliary: logLine?.auxiliary || {},
  };
}

function summarizeStagehandPhaseLogs(logLines, excludedAgentTools = []) {
  const toolCalls = Array.from(new Set(
    (Array.isArray(logLines) ? logLines : [])
      .map((entry) => {
        const match = String(entry?.message || "").match(/Agent calling tool:\s*([A-Za-z0-9_-]+)/i);
        return match ? match[1] : null;
      })
      .filter(Boolean),
  ));
  const forbiddenToolCalls = toolCalls.filter((toolName) => excludedAgentTools.includes(toolName));
  const cacheEvents = (Array.isArray(logLines) ? logLines : []).filter((entry) => entry?.category === "cache");

  return {
    toolCalls,
    forbiddenToolCalls,
    cacheHit: cacheEvents.some((entry) => /cache hit/i.test(entry.message || "")),
    cacheEvents: cacheEvents.map((entry) => entry.message),
  };
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readChangedFiles(args) {
  const inline = normalizeArray(args["changed-file"]);
  const filePath = args["changed-files-file"] ? path.resolve(String(args["changed-files-file"])) : null;

  if (!filePath) {
    return inline;
  }

  const body = await fs.readFile(filePath, "utf8");
  const trimmed = body.trim();
  if (!trimmed) {
    return inline;
  }

  let parsed = [];
  if (trimmed.startsWith("[")) {
    parsed = JSON.parse(trimmed);
  } else {
    parsed = trimmed.split(/\r?\n/g);
  }

  return Array.from(new Set([...inline, ...parsed.map((entry) => String(entry || "").trim()).filter(Boolean)]));
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractStoryTopic(story) {
  const text = String(story || "").trim();
  const aboutMatch = text.match(/\babout\s+(.+?)(?:,| and | with | so | then |\.|$)/i);
  if (aboutMatch) {
    return aboutMatch[1].trim();
  }
  const featureMatch = text.match(/\b(?:create|show|open)\s+(?:a|an|the)?\s*(.+?)(?:,| and | with | so | then |\.|$)/i);
  if (featureMatch) {
    return featureMatch[1].trim();
  }
  return "feedback workflow";
}

function buildFeedbackRepairDraft(brief) {
  const topic = extractStoryTopic(brief.story);
  const normalizedTopic = topic.replace(/^a\s+/i, "").replace(/^an\s+/i, "").trim() || "feedback workflow";
  const title = /feedback inbox/i.test(normalizedTopic)
    ? "Feedback Inbox for Centralizing User Ideas"
    : toTitleCase(normalizedTopic).slice(0, 80);

  return {
    title,
    body: [
      `Create a dedicated ${normalizedTopic} so the team can collect incoming ideas in one place.`,
      "Keep the discussion, status, and next steps visible for demos and changelog captures.",
    ].join(" "),
    comment: "This inbox keeps new customer ideas organized and ready for review.",
  };
}

function buildAgentRepairDraft() {
  return {
    name: "AtlasDemoAgent",
    role: "Product Copilot",
    personality: "Clear, steady, and strong at turning product intent into visible next steps.",
    systemPrompt: "Help the team explain features, suggest follow-up actions, and keep the demo focused on visible product value.",
  };
}

function resolveAgentModelConfig() {
  const preferred = String(process.env.AURA_DEMO_AGENT_MODEL || "anthropic/claude-sonnet-4-6").trim();
  const [prefix, suffix] = preferred.includes("/") ? preferred.split("/", 2) : [null, preferred];
  const normalizedProvider = prefix || (/claude|anthropic/i.test(suffix) ? "anthropic" : /gpt|o\d|openai/i.test(suffix) ? "openai" : null);
  const modelName = prefix ? preferred : normalizedProvider ? `${normalizedProvider}/${suffix}` : preferred;

  if (normalizedProvider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the default demo agent model.");
    }
    return {
      modelName,
      provider: "anthropic",
      apiKey,
      waitBetweenActions: 200,
      temperature: 0,
    };
  }

  if (normalizedProvider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(`OPENAI_API_KEY is required for agent model ${modelName}.`);
    }
    return {
      modelName,
      provider: "openai",
      apiKey,
      waitBetweenActions: 200,
      temperature: 0,
    };
  }

  throw new Error(`Unsupported agent model ${modelName}. Set AURA_DEMO_AGENT_MODEL to an Anthropic or OpenAI model.`);
}

function isVisibleBox(box) {
  return box && box.width > 0 && box.height > 0;
}

const TARGET_SCREENSHOT_ASPECT_RATIO = 16 / 9;
const EARLY_STOP_REASON = "proof-achieved";

async function firstVisibleBox(candidates) {
  for (const candidate of candidates) {
    const locator = candidate.locator.first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    const box = await locator.boundingBox().catch(() => null);
    if (!isVisibleBox(box)) continue;
    return {
      ...candidate,
      locator,
      box,
    };
  }
  return null;
}

function expandPadding(padding) {
  if (typeof padding === "number") {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    };
  }
  return {
    top: Number(padding?.top || 0),
    right: Number(padding?.right || 0),
    bottom: Number(padding?.bottom || 0),
    left: Number(padding?.left || 0),
  };
}

async function unionClip(page, locators, padding = 24) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox().catch(() => null);
    if (isVisibleBox(box)) {
      boxes.push(box);
    }
  }

  if (boxes.length === 0) {
    return null;
  }

  const viewport = page.viewportSize() ?? { width: 1600, height: 1000 };
  const bounds = {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.min(...boxes.map((box) => box.y)),
    width: Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x)),
    height: Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y)),
  };
  const inset = expandPadding(padding);
  const padded = {
    x: Math.max(0, bounds.x - inset.left),
    y: Math.max(0, bounds.y - inset.top),
    width: Math.min(viewport.width, bounds.x + bounds.width + inset.right) - Math.max(0, bounds.x - inset.left),
    height: Math.min(viewport.height, bounds.y + bounds.height + inset.bottom) - Math.max(0, bounds.y - inset.top),
  };

  const minWidth = Math.min(viewport.width, Math.max(720, padded.width));
  const minHeight = Math.min(viewport.height, Math.max(420, padded.height));
  let width = Math.max(padded.width, minWidth);
  let height = Math.max(padded.height, minHeight);
  const centerX = padded.x + (padded.width / 2);
  const centerY = padded.y + (padded.height / 2);

  if (width / height < TARGET_SCREENSHOT_ASPECT_RATIO) {
    width = Math.min(viewport.width, Math.max(width, height * TARGET_SCREENSHOT_ASPECT_RATIO));
    height = width / TARGET_SCREENSHOT_ASPECT_RATIO;
  } else {
    height = Math.min(viewport.height, Math.max(height, width / TARGET_SCREENSHOT_ASPECT_RATIO));
    width = height * TARGET_SCREENSHOT_ASPECT_RATIO;
  }

  width = Math.min(viewport.width, width);
  height = Math.min(viewport.height, height);

  let x = centerX - (width / 2);
  let y = centerY - (height / 2);
  x = Math.max(0, Math.min(x, viewport.width - width));
  y = Math.max(0, Math.min(y, viewport.height - height));

  return {
    x,
    y,
    width,
    height,
  };
}

async function captureProofScreenshot(page, outputPath = null) {
  const dialogShot = await firstVisibleBox([
    { kind: "dialog", locator: page.getByRole("dialog"), padding: 24 },
    { kind: "agent-editor", locator: page.locator('[data-agent-surface="agent-editor"]'), padding: 24 },
    { kind: "feedback-composer", locator: page.locator('[data-agent-surface="feedback-composer"]'), padding: 24 },
  ]);

  if (dialogShot) {
    const clip = await unionClip(page, [dialogShot.locator], dialogShot.padding);
    await page.screenshot({ ...(outputPath ? { path: outputPath } : {}), clip: clip ?? undefined });
    return {
      kind: dialogShot.kind,
      targets: [dialogShot.kind],
      clip,
    };
  }

  const mainPanel = page.locator('[data-agent-surface="main-panel"]').first();
  const sidekickHeader = page.locator('[data-agent-surface="sidekick-header"]').first();
  const sidekickPanel = page.locator('[data-agent-surface="sidekick-panel"]').first();
  const shellPlaceholder = page.locator('[data-agent-surface="shell-route-placeholder"]').first();
  const feedbackThread = page.locator('[data-agent-surface="feedback-thread"]').first();
  const agentList = page.locator('[data-agent-surface="agent-list"]').first();
  const agentChatPanel = page.locator('[data-agent-surface="agent-chat-panel"]').first();
  const agentDetailPanel = page.locator('[data-agent-surface="agent-detail-panel"]').first();
  const notesEditor = page.locator('[data-agent-surface="notes-editor"]').first();

  const visibleTargets = [];
  for (const target of [
    { kind: "notes-editor", locator: notesEditor },
    { kind: "feedback-thread", locator: feedbackThread },
    { kind: "agent-list", locator: agentList },
    { kind: "agent-chat-panel", locator: agentChatPanel },
    { kind: "agent-detail-panel", locator: agentDetailPanel },
    { kind: "main-panel", locator: mainPanel },
    { kind: "sidekick-header", locator: sidekickHeader },
    { kind: "sidekick-panel", locator: sidekickPanel },
    { kind: "shell-route-placeholder", locator: shellPlaceholder },
  ]) {
    const count = await target.locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await target.locator.isVisible().catch(() => false);
    if (visible) {
      visibleTargets.push(target);
    }
  }

  if (visibleTargets.length > 0) {
    const clip = await unionClip(page, visibleTargets.map((target) => target.locator), 24);
    await page.screenshot({ ...(outputPath ? { path: outputPath } : {}), clip: clip ?? undefined });
    return {
      kind: "surface-union",
      targets: visibleTargets.map((target) => target.kind),
      clip,
    };
  }

  await page.screenshot({ ...(outputPath ? { path: outputPath } : {}), fullPage: true });
  return {
    kind: "full-page",
    targets: ["body"],
    clip: null,
  };
}

function resolveScreenshotTargetLocators(page, screenshot) {
  const locators = [];
  const addTarget = (targetName, locator) => {
    if (Array.isArray(screenshot?.targets) && screenshot.targets.includes(targetName)) {
      locators.push(locator.first());
    }
  };

  if (!screenshot) {
    return locators;
  }

  if (screenshot.kind === "dialog") {
    locators.push(page.getByRole("dialog").first());
    return locators;
  }
  if (screenshot.kind === "agent-editor") {
    locators.push(page.locator('[data-agent-surface="agent-editor"]').first());
    return locators;
  }
  if (screenshot.kind === "feedback-composer") {
    locators.push(page.locator('[data-agent-surface="feedback-composer"]').first());
    return locators;
  }

  addTarget("notes-editor", page.locator('[data-agent-surface="notes-editor"]'));
  addTarget("feedback-thread", page.locator('[data-agent-surface="feedback-thread"]'));
  addTarget("agent-list", page.locator('[data-agent-surface="agent-list"]'));
  addTarget("agent-chat-panel", page.locator('[data-agent-surface="agent-chat-panel"]'));
  addTarget("agent-detail-panel", page.locator('[data-agent-surface="agent-detail-panel"]'));
  addTarget("main-panel", page.locator('[data-agent-surface="main-panel"]'));
  addTarget("sidekick-header", page.locator('[data-agent-surface="sidekick-header"]'));
  addTarget("sidekick-panel", page.locator('[data-agent-surface="sidekick-panel"]'));
  addTarget("shell-route-placeholder", page.locator('[data-agent-surface="shell-route-placeholder"]'));

  return locators;
}

async function collectProofVisibleText(page, screenshot) {
  const chunks = [];
  for (const locator of resolveScreenshotTargetLocators(page, screenshot)) {
    if (!await maybeVisible(locator)) {
      continue;
    }
    const text = String(await locator.innerText().catch(() => "")).trim();
    if (text) {
      chunks.push(text);
    }
  }

  const combined = normalizeArray(chunks, 16).join("\n\n").trim();
  if (combined) {
    return clipText(combined, 2500);
  }

  return clipText(await page.locator("body").innerText().catch(() => ""), 2500);
}

function buildPhasePlan(brief) {
  const targetLabel = brief.targetAppLabel || "relevant";
  const startsInsideTargetApp = brief.startPath && brief.startPath !== "/desktop";
  const validationSignals = Array.isArray(brief.validationSignals) ? brief.validationSignals : [];
  const proofRequirements = Array.isArray(brief.proofRequirements) ? brief.proofRequirements : [];
  const requiredUiSignals = Array.isArray(brief.requiredUiSignals) ? brief.requiredUiSignals : [];
  const forbiddenPhrases = Array.isArray(brief.forbiddenPhrases) ? brief.forbiddenPhrases : [];
  const minSignalMatches = validationSignals.length >= 4 ? 2 : validationSignals.length > 0 ? 1 : 0;
  const expectedRoute = brief.startPath && brief.startPath !== "/desktop" ? brief.startPath : null;
  return [
    {
      id: "setup-state",
      title: startsInsideTargetApp ? "Stabilize target app" : "Set up proof state",
      required: true,
      screenshot: "01-setup-state.png",
      instruction: [
        brief.setupInstruction || brief.openAppInstruction,
        `The target app is ${targetLabel}.`,
        startsInsideTargetApp
          ? "You are already starting inside the target app route. Do not open the app launcher unless the target app is clearly not visible."
          : "Prefer the launcher or taskbar path over guessing URLs by hand.",
      ].join(" "),
      validationSignals: normalizeArray([
        brief.targetAppLabel,
        ...(Array.isArray(brief.validationSignals) ? brief.validationSignals.slice(0, 2) : []),
      ]),
      minSignalMatches: 1,
      proofRequirements,
      requiredUiSignals,
      forbiddenPhrases,
      expectedRoute,
      expectedAppId: brief.targetAppId || null,
      expectedAppLabel: brief.targetAppLabel || null,
    },
    {
      id: "validate-proof",
      title: "Validate proof",
      required: true,
      screenshot: "02-validate-proof.png",
      instruction: brief.validationInstruction || brief.proofInstruction,
      validationSignals,
      minSignalMatches,
      proofRequirements,
      requiredUiSignals,
      forbiddenPhrases,
      expectedRoute,
      expectedAppId: brief.targetAppId || null,
      expectedAppLabel: brief.targetAppLabel || null,
    },
    {
      id: "capture-proof",
      title: "Capture proof",
      required: false,
      screenshot: "03-capture-proof.png",
      instruction: brief.interactionInstruction,
      validationSignals,
      minSignalMatches,
      proofRequirements,
      requiredUiSignals,
      forbiddenPhrases,
      expectedRoute,
      expectedAppId: brief.targetAppId || null,
      expectedAppLabel: brief.targetAppLabel || null,
    },
  ];
}

function isAgentCreationStory(story) {
  return /\b(?:create|new)\s+(?:an?\s+)?agent\b/i.test(String(story || ""))
    || /\bagent\s+(?:creation|editor|composer)\b/i.test(String(story || ""));
}

async function waitForUiToSettle(page) {
  await page.waitForTimeout(1200);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);
}

async function waitForUiCheckpoint(page) {
  await page.waitForTimeout(250);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(150);
}

function isLikelyRouteMissText(value) {
  return /\b(?:not found|page not found|404|cannot get)\b/i.test(String(value || ""));
}

async function writeText(filePath, value) {
  await fs.writeFile(filePath, String(value || ""), "utf8");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function maybeVisible(locator) {
  const count = await locator.count().catch(() => 0);
  if (!count) return false;
  return locator.first().isVisible().catch(() => false);
}

async function maybeClick(locator) {
  if (!await maybeVisible(locator)) {
    return false;
  }
  await locator.first().click({ force: true });
  return true;
}

async function collectBootstrapAssessment(page) {
  const visibleText = clipText(await page.locator("body").innerText().catch(() => ""), 240);
  const launcherVisible = await maybeVisible(page.locator('[data-agent-role="app-launcher"]').first());
  const mainPanelVisible = await maybeVisible(page.locator('[data-agent-surface="main-panel"]').first());
  const shellVisible = launcherVisible || mainPanelVisible;

  return {
    currentUrl: page.url(),
    visibleText,
    launcherVisible,
    mainPanelVisible,
    shellVisible,
    routeMissLikely: !shellVisible && isLikelyRouteMissText(visibleText),
  };
}

async function waitForCaptureBridge(page, timeoutMs = 15_000) {
  await page.waitForFunction(
    () => typeof window.__AURA_CAPTURE_BRIDGE__?.resetShell === "function",
    null,
    { timeout: timeoutMs },
  );
}

async function resetBootstrapShellWithBridge(page, brief, consoleMessages = []) {
  const bridgeVisible = await page.evaluate(
    () => typeof window.__AURA_CAPTURE_BRIDGE__?.resetShell === "function",
  ).catch(() => false);

  if (!bridgeVisible) {
    return {
      attempted: false,
      available: false,
      success: false,
      reason: "bridge-unavailable",
      state: await collectBootstrapAssessment(page),
    };
  }

  const result = await page.evaluate(
    async (request) => {
      return window.__AURA_CAPTURE_BRIDGE__.resetShell(request);
    },
    {
      targetAppId: brief?.targetAppId || null,
      targetPath: brief?.startPath || null,
      sidekickCollapsed: false,
      timeoutMs: 7_000,
    },
  ).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    state: null,
  }));

  consoleMessages.push(
    `[bootstrap] capture bridge reset -> ${JSON.stringify({
      ok: Boolean(result?.ok),
      targetAppId: result?.targetAppId ?? brief?.targetAppId ?? null,
      targetPath: result?.targetPath ?? brief?.startPath ?? null,
      currentPath: result?.state?.currentPath ?? null,
      activeAppId: result?.state?.activeAppId ?? null,
    })}`,
  );

  return {
    attempted: true,
    available: true,
    success: Boolean(result?.ok),
    reason: result?.ok ? "bridge-reset" : "bridge-reset-incomplete",
    error: result?.error ?? null,
    state: result?.state ?? await collectBootstrapAssessment(page),
  };
}

async function recoverBootstrapRouteMiss(page, baseUrl, initialUrl, consoleMessages = []) {
  const initial = await collectBootstrapAssessment(page);
  const baseRootUrl = new URL(baseUrl).toString();
  const initialHref = new URL(initialUrl).toString();

  if (!initial.routeMissLikely || initial.currentUrl === baseRootUrl || initialHref === baseRootUrl) {
    return {
      recovered: false,
      initial,
      fallback: null,
    };
  }

  consoleMessages.push(
    `[bootstrap] initial route ${initial.currentUrl} looks like a route miss; retrying from root ${baseRootUrl}`,
  );
  await page.goto(baseRootUrl, {
    waitUntil: "domcontentloaded",
  });
  await waitForUiToSettle(page);

  return {
    recovered: true,
    initial,
    fallback: await collectBootstrapAssessment(page),
  };
}

async function maybePrimeTargetAppFromLauncher(page, brief, consoleMessages = []) {
  if (!brief?.targetAppId) {
    return {
      attempted: false,
      reason: "no-target-app",
      success: false,
    };
  }

  const activeMainPanel = page
    .locator(`[data-agent-surface="main-panel"][data-agent-active-app-id="${brief.targetAppId}"]`)
    .first();
  if (await maybeVisible(activeMainPanel)) {
    return {
      attempted: false,
      reason: "already-visible",
      success: true,
      currentUrl: page.url(),
      activeAppId: brief.targetAppId,
    };
  }

  let launcher = page.locator(`[data-agent-role="app-launcher"][data-agent-app-id="${brief.targetAppId}"]`).first();
  if (!await maybeVisible(launcher) && brief.targetAppLabel) {
    launcher = page.locator(`[data-agent-role="app-launcher"][data-agent-app-label="${brief.targetAppLabel}"]`).first();
  }

  if (!await maybeVisible(launcher)) {
    return {
      attempted: false,
      reason: "no-visible-launcher",
      success: false,
      currentUrl: page.url(),
    };
  }

  await launcher.click({ force: true });
  await waitForUiToSettle(page);
  const activeAppId = await page
    .locator('[data-agent-surface="main-panel"]')
    .first()
    .getAttribute("data-agent-active-app-id")
    .catch(() => null);
  const success = activeAppId === brief.targetAppId || page.url().includes(`/${brief.targetAppId}`);
  consoleMessages.push(`[bootstrap] clicked visible launcher for ${brief.targetAppId}; current URL ${page.url()}`);

  return {
    attempted: true,
    reason: "launcher-clicked",
    success,
    currentUrl: page.url(),
    activeAppId,
  };
}

function shouldAttemptFeedbackRepair(brief) {
  return brief.targetAppId === "feedback" && /\b(create|new idea|post|submit)\b/i.test(brief.story);
}

function shouldAttemptAgentRepair(brief) {
  return brief.targetAppId === "agents" && isAgentCreationStory(brief.story);
}

function hasMeaningfulVisibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().length >= 24;
}

function normalizeTextForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectValidationSignalMatches(visibleText, signals = []) {
  const normalizedVisible = normalizeTextForMatch(visibleText);
  return normalizeArray(signals, 12).filter((signal) => {
    const normalizedSignal = normalizeTextForMatch(signal);
    return normalizedSignal && normalizedVisible.includes(normalizedSignal);
  });
}

function collectForbiddenPhraseMatches(visibleText, phrases = []) {
  const normalizedVisible = normalizeTextForMatch(visibleText);
  return normalizeArray(phrases, 12).filter((phrase) => {
    const normalizedPhrase = normalizeTextForMatch(phrase);
    return normalizedPhrase && normalizedVisible.includes(normalizedPhrase);
  });
}

function collectProofRequirementMatches(visibleText, requirements = []) {
  const normalizedVisible = normalizeTextForMatch(visibleText);
  return (Array.isArray(requirements) ? requirements : [])
    .map((requirement) => {
      const anyOf = normalizeArray(requirement?.anyOf ?? requirement?.signals ?? [], 6);
      const matchedPhrase = anyOf.find((phrase) => {
        const normalizedPhrase = normalizeTextForMatch(phrase);
        return normalizedPhrase && normalizedVisible.includes(normalizedPhrase);
      });
      if (!matchedPhrase) {
        return null;
      }
      return {
        label: String(requirement?.label || matchedPhrase).trim(),
        matchedPhrase,
        anyOf,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function hasExpectedRoute(currentUrl, expectedRoute) {
  if (!expectedRoute) {
    return true;
  }

  try {
    const url = new URL(currentUrl);
    return url.pathname.startsWith(expectedRoute);
  } catch {
    return String(currentUrl || "").includes(expectedRoute);
  }
}

async function collectPageUiSignals(page) {
  return page.evaluate(() => {
    const isVisible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.05
        && rect.width > 0
        && rect.height > 0;
    };
    const bodyText = document.body?.innerText || "";
    const mainPanel = document.querySelector('[data-agent-surface="main-panel"]');
    const mobileLayoutSelectors = [
      '[aria-label="Feedback filters"]',
      '[aria-label="Feed filters"]',
      '[aria-label="Profile activity filter"]',
    ];
    const errorPatterns = [
      /something went wrong/i,
      /could not load/i,
      /permission denied/i,
      /rows is not iterable/i,
    ];

    return {
      activeAppId: mainPanel?.getAttribute("data-agent-active-app-id") || null,
      activeAppLabel: mainPanel?.getAttribute("data-agent-active-app-label") || null,
      placeholderVisible: isVisible('[data-agent-surface="shell-route-placeholder"]'),
      emptyStateVisible: Array.from(document.querySelectorAll("[data-agent-empty-state]")).some((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0.05
          && rect.width > 0
          && rect.height > 0;
      }),
      mobileLayoutVisible: mobileLayoutSelectors.some((selector) => isVisible(selector)),
      errorTextVisible: errorPatterns.some((pattern) => pattern.test(bodyText)),
      feedbackThreadVisible: isVisible('[data-agent-surface="feedback-thread"]'),
      notesEditorVisible: isVisible('[data-agent-surface="notes-editor"]'),
      sidekickVisible: isVisible('[data-agent-surface="sidekick-panel"]'),
    };
  }).catch(() => ({
    activeAppId: null,
    activeAppLabel: null,
    placeholderVisible: false,
    emptyStateVisible: false,
    mobileLayoutVisible: false,
    errorTextVisible: false,
    feedbackThreadVisible: false,
    notesEditorVisible: false,
    sidekickVisible: false,
  }));
}

function buildQualityRetryInstruction(phase, phaseResult) {
  const failedChecks = (phaseResult?.quality?.checks ?? [])
    .filter((check) => !check.ok)
    .map((check) => check.name);
  const guidance = [];

  if (failedChecks.includes("placeholder-surface")) {
    guidance.push("Leave the placeholder route and open the real app surface from visible desktop navigation.");
  }
  if (failedChecks.includes("empty-state")) {
    guidance.push("Avoid empty states and show an existing seeded item, tab, sidekick, or detail view with meaningful content.");
  }
  if (failedChecks.includes("desktop-layout")) {
    guidance.push("Keep the desktop layout visible and avoid any mobile-specific filter bars or compact shells.");
  }
  if (failedChecks.includes("route-or-app-match")) {
    guidance.push(`Stay inside the ${phase.expectedAppLabel || "target"} app and center that proof surface.`);
  }
  if (failedChecks.includes("signal-match")) {
    guidance.push(`Make these proof signals visibly present before stopping: ${(phase.validationSignals ?? []).join("; ")}.`);
  }
  if (failedChecks.includes("proof-requirements")) {
    guidance.push(`Keep these story-specific proof details visible inside the crop: ${(phase.proofRequirements ?? []).map((entry) => entry.label).join("; ")}.`);
  }
  if (failedChecks.includes("required-ui-state")) {
    guidance.push(`Open the required UI state before stopping: ${(phase.requiredUiSignals ?? []).join(", ")}.`);
  }
  if (failedChecks.includes("forbidden-proof-phrase")) {
    guidance.push(`Avoid placeholder or misleading text such as: ${(phase.forbiddenPhrases ?? []).join("; ")}.`);
  }
  if (failedChecks.includes("composed-crop")) {
    guidance.push("Center the proof surface so the screenshot is tightly framed around the main panel and sidekick, not a loose full-page view.");
  }
  if (failedChecks.includes("runtime-error")) {
    guidance.push("Avoid any screen showing errors or crashes.");
  }
  if (failedChecks.includes("forbidden-tool")) {
    guidance.push("Use visible controls only. Do not navigate by URL or rely on any disallowed tool.");
  }

  if (guidance.length === 0) {
    guidance.push("Improve the proof state quality and stop on the clearest, centered desktop surface.");
  }

  return [
    phase.instruction,
    "Correction pass:",
    ...guidance,
    "Make one focused correction only, then stop as soon as the better proof screen is visible.",
  ].join(" ");
}

function shouldRetryPhaseForQuality(phaseResult) {
  if (!phaseResult?.quality) {
    return false;
  }
  if (phaseResult.quality.ok && phaseResult.quality.score >= (phaseResult.required ? 72 : 78)) {
    return false;
  }
  return true;
}

function shouldEarlyExitCapturePhase({ phase, previousPhase }) {
  if (phase?.id !== "capture-proof") {
    return false;
  }
  if (!previousPhase || previousPhase.id !== "validate-proof") {
    return false;
  }
  if (!previousPhase.success || !previousPhase.completed) {
    return false;
  }
  if (!previousPhase.quality?.ok || Number(previousPhase.quality?.score || 0) < 96) {
    return false;
  }
  if (previousPhase.proofRequirementsOk === false || previousPhase.requiredUiStateOk === false) {
    return false;
  }
  if ((previousPhase.forbiddenPhraseMatches ?? []).length > 0) {
    return false;
  }
  if (previousPhase.screenshot?.kind === "full-page") {
    return false;
  }
  const requiredSignalMatches = Math.max(phase.minSignalMatches ?? 0, 1);
  if ((previousPhase.validationMatches ?? []).length < requiredSignalMatches) {
    return false;
  }
  return true;
}

async function buildEarlyExitPhaseResult({ phase, previousPhase, phasesDir }) {
  const screenshotPath = path.join(phasesDir, phase.screenshot);
  if (previousPhase?.screenshot?.path && previousPhase.screenshot.path !== screenshotPath) {
    await fs.copyFile(previousPhase.screenshot.path, screenshotPath);
  }
  const timestamp = new Date().toISOString();
  return {
    ...previousPhase,
    id: phase.id,
    title: phase.title,
    required: phase.required,
    instruction: phase.instruction,
    actionCount: 0,
    actions: [],
    message: [
      `Skipped "${phase.id}" because "${previousPhase.id}" already produced a high-confidence proof frame.`,
      `Reused the screenshot from "${previousPhase.id}" to avoid an unnecessary extra agent cycle.`,
    ].join(" "),
    screenshot: {
      ...previousPhase.screenshot,
      path: screenshotPath,
    },
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    skipped: true,
    skipReason: "validate-proof already produced a strong, production-quality proof frame",
    earlyExit: {
      fromPhaseId: previousPhase.id,
      reusedScreenshot: true,
    },
    attempts: [
      {
        screenshotPath,
        success: previousPhase.success,
        qualityScore: previousPhase.quality?.score ?? null,
        qualityOk: previousPhase.quality?.ok ?? null,
        validationMatches: previousPhase.validationMatches,
        skipped: true,
        reusedFromPhaseId: previousPhase.id,
      },
    ],
  };
}

function phaseResultRank(phaseResult) {
  let score = 0;
  if (phaseResult?.success) score += 140;
  if (phaseResult?.completed) score += 30;
  if (phaseResult?.locallyValidated) score += 40;
  if (phaseResult?.quality?.ok) score += 35;
  score += Number(phaseResult?.quality?.score || 0);
  score += (Array.isArray(phaseResult?.validationMatches) ? phaseResult.validationMatches.length : 0) * 8;
  if (phaseResult?.screenshot?.kind !== "full-page") score += 6;
  return score;
}

function shouldStopAgentEarlyForProof({ phase, assessment, stepCount }) {
  if (!assessment || stepCount < 1) {
    return false;
  }
  if (!assessment.locallyValidated || !assessment.quality?.ok) {
    return false;
  }
  if (assessment.proofRequirementsOk === false || assessment.requiredUiStateOk === false) {
    return false;
  }
  if ((assessment.forbiddenPhraseMatches ?? []).length > 0) {
    return false;
  }
  if ((assessment.stagehand?.forbiddenToolCalls ?? []).length > 0) {
    return false;
  }
  const minimumScore = phase.id === "setup-state" ? 90 : 94;
  return Number(assessment.quality?.score || 0) >= minimumScore;
}

async function chooseBestPhaseResult({ initialResult, retryResult = null }) {
  if (!retryResult) {
    return initialResult;
  }
  return phaseResultRank(retryResult) > phaseResultRank(initialResult) ? retryResult : initialResult;
}

async function applyOptionalPhaseFallback(phaseResult, previousPhase) {
  if (!previousPhase?.screenshot?.path || !phaseResult?.screenshot?.path) {
    return false;
  }

  await fs.copyFile(previousPhase.screenshot.path, phaseResult.screenshot.path);
  phaseResult.screenshot = {
    ...previousPhase.screenshot,
    path: phaseResult.screenshot.path,
  };
  phaseResult.fallback = {
    reusedScreenshotFromPhaseId: previousPhase.id,
    reason: "Optional phase ended on a low-quality or blank state, so the last successful proof screenshot was reused.",
  };
  if (previousPhase?.quality) {
    phaseResult.quality = previousPhase.quality;
  }
  phaseResult.message = [
    phaseResult.message,
    `Fallback applied: reused the screenshot from phase "${previousPhase.id}" to avoid shipping a degraded proof frame.`,
  ].filter(Boolean).join("\n\n");
  return true;
}

function shouldReusePreviousPhaseScreenshot(phaseResult, previousPhase) {
  if (phaseResult?.required || !previousPhase?.success) {
    return false;
  }

  if (!phaseResult?.success) {
    return true;
  }

  return !phaseResult?.quality?.ok
    || (!hasMeaningfulVisibleText(phaseResult.visibleText) && phaseResult?.screenshot?.kind === "full-page");
}

async function runFeedbackRepair(page, brief, phasesDir) {
  const repair = {
    attempted: false,
    success: false,
    draft: buildFeedbackRepairDraft(brief),
    steps: [],
    screenshot: null,
  };

  const composer = page.locator('[data-agent-surface="feedback-composer"]').first();
  const composerVisible = await maybeVisible(composer);

  if (!composerVisible) {
    const opened = await maybeClick(page.locator('[data-agent-action="open-feedback-composer"]'));
    if (!opened) {
      return repair;
    }
    repair.attempted = true;
    repair.steps.push("opened-feedback-composer");
    await waitForUiToSettle(page);
  } else {
    repair.attempted = true;
  }

  const titleField = page.getByLabel("Feedback title").first();
  const bodyField = page.getByLabel("Feedback body").first();
  if (await maybeVisible(titleField)) {
    await titleField.fill(repair.draft.title);
    repair.steps.push("filled-feedback-title");
  }
  if (await maybeVisible(bodyField)) {
    await bodyField.fill(repair.draft.body);
    repair.steps.push("filled-feedback-body");
  }

  const submitButton = page.getByLabel("Post feedback").first();
  const canSubmit = await maybeVisible(submitButton) && await submitButton.isEnabled().catch(() => false);
  if (canSubmit) {
    await submitButton.click({ force: true });
    repair.steps.push("submitted-feedback");
    await waitForUiToSettle(page);
  }

  const titleMatcher = new RegExp(`^Open feedback item: ${escapeRegex(repair.draft.title)}`, "i");
  const createdItemButton = page.getByLabel(titleMatcher).first();
  if (await maybeVisible(createdItemButton)) {
    await createdItemButton.click({ force: true });
    repair.steps.push("opened-created-feedback-item");
    await waitForUiToSettle(page);
  }

  const commentField = page.getByLabel("Add a comment").first();
  const sendCommentButton = page.getByLabel("Send comment").first();
  if (await maybeVisible(commentField)) {
    await commentField.fill(repair.draft.comment);
    repair.steps.push("filled-feedback-comment");
    const canSendComment = await maybeVisible(sendCommentButton) && await sendCommentButton.isEnabled().catch(() => false);
    if (canSendComment) {
      await sendCommentButton.click({ force: true });
      repair.steps.push("submitted-feedback-comment");
      await waitForUiToSettle(page);
    }
  }

  const createdTitleVisible = await page.getByText(repair.draft.title, { exact: false }).first().isVisible().catch(() => false);
  const threadVisible = await maybeVisible(page.locator('[data-agent-surface="feedback-thread"]'));
  const commentVisible = await page.getByText(repair.draft.comment, { exact: false }).first().isVisible().catch(() => false);
  repair.success = createdTitleVisible && threadVisible && commentVisible;

  if (repair.attempted) {
    const screenshotPath = path.join(phasesDir, "04-repaired-result.png");
    const screenshotMeta = await captureProofScreenshot(page, screenshotPath);
    repair.screenshot = {
      path: screenshotPath,
      ...screenshotMeta,
    };
  }

  return repair;
}

async function runAgentRepair(page, phasesDir) {
  const repair = {
    attempted: false,
    success: false,
    draft: buildAgentRepairDraft(),
    steps: [],
    screenshot: null,
  };

  const dialog = page.locator('[data-agent-surface="agent-editor"]').first();
  const dialogVisible = await maybeVisible(dialog);
  const selectedCreatedRow = page.locator(
    `[data-agent-role="agent-row"][data-agent-selected="true"][data-agent-agent-name="${repair.draft.name}"]`,
  ).first();
  const createdNameVisible = await page.getByText(repair.draft.name, { exact: false }).first().isVisible().catch(() => false);
  const selectedRowVisible = await maybeVisible(selectedCreatedRow);
  const detailVisible = await maybeVisible(page.locator('[data-agent-surface="agent-detail-panel"]'));
  const alreadyCreated = !dialogVisible
    && createdNameVisible
    && selectedRowVisible
    && detailVisible
    && !/\/agents\/undefined(?:$|[?#])/.test(page.url());

  if (alreadyCreated) {
    repair.success = true;
    repair.steps.push("reused-existing-agent-proof");
    const screenshotPath = path.join(phasesDir, "04-repaired-result.png");
    const screenshotMeta = await captureProofScreenshot(page, screenshotPath);
    repair.screenshot = {
      path: screenshotPath,
      ...screenshotMeta,
    };
    return repair;
  }

  if (!dialogVisible) {
    const newAgentButton = page.getByRole("button", { name: "New Agent" }).first();
    const opened = await maybeClick(newAgentButton);
    if (!opened) {
      return repair;
    }
    repair.attempted = true;
    repair.steps.push("opened-agent-editor");
    await waitForUiToSettle(page);
  } else {
    repair.attempted = true;
  }

  const nameField = page.getByLabel("Name").first();
  const roleField = page.getByLabel("Role").first();
  const personalityField = page.getByLabel("Personality").first();
  const systemPromptField = page.getByLabel("System Prompt").first();

  if (await maybeVisible(nameField)) {
    await nameField.fill(repair.draft.name);
    repair.steps.push("filled-agent-name");
  }
  if (await maybeVisible(roleField)) {
    await roleField.fill(repair.draft.role);
    repair.steps.push("filled-agent-role");
  }
  if (await maybeVisible(personalityField)) {
    await personalityField.fill(repair.draft.personality);
    repair.steps.push("filled-agent-personality");
  }
  if (await maybeVisible(systemPromptField)) {
    await systemPromptField.fill(repair.draft.systemPrompt);
    repair.steps.push("filled-agent-system-prompt");
  }

  const createButton = page.getByRole("button", { name: "Create Agent" }).first();
  const canSubmit = await maybeVisible(createButton) && await createButton.isEnabled().catch(() => false);
  if (canSubmit) {
    await createButton.click({ force: true });
    repair.steps.push("submitted-agent-create");
    await page.waitForURL(/\/agents\/[^/]+$/, { timeout: 15_000 }).catch(() => {});
    await waitForUiToSettle(page);
  }

  const selectedRow = page.locator(
    `[data-agent-role="agent-row"][data-agent-selected="true"][data-agent-agent-name="${repair.draft.name}"]`,
  ).first();
  const createdNameVisibleAfter = await page.getByText(repair.draft.name, { exact: false }).first().isVisible().catch(() => false);
  const selectedRowVisibleAfter = await maybeVisible(selectedRow);
  const detailVisibleAfter = await maybeVisible(page.locator('[data-agent-surface="agent-detail-panel"]'));
  const invalidUrl = /\/agents\/undefined(?:$|[?#])/.test(page.url());

  repair.success = !invalidUrl && createdNameVisibleAfter && (selectedRowVisibleAfter || detailVisibleAfter);

  if (repair.attempted) {
    const screenshotPath = path.join(phasesDir, "04-repaired-result.png");
    const screenshotMeta = await captureProofScreenshot(page, screenshotPath);
    repair.screenshot = {
      path: screenshotPath,
      ...screenshotMeta,
    };
  }

  return repair;
}

async function runAgentPhase({ agent, page, phase, phasesDir, excludedAgentTools, stagehandLogs }) {
  async function assessPhaseState({ screenshotPath = null, settleMode = "full", stagehandLogCursor = 0 }) {
    if (settleMode === "checkpoint") {
      await waitForUiCheckpoint(page);
    } else {
      await waitForUiToSettle(page);
    }

    const screenshot = await captureProofScreenshot(page, screenshotPath);
    const currentUrl = page.url();
    const visibleText = await collectProofVisibleText(page, screenshot);
    const validationMatches = collectValidationSignalMatches(visibleText, phase.validationSignals);
    const proofRequirementMatches = collectProofRequirementMatches(visibleText, phase.proofRequirements);
    const forbiddenPhraseMatches = collectForbiddenPhraseMatches(visibleText, phase.forbiddenPhrases);
    const routeMatched = hasExpectedRoute(currentUrl, phase.expectedRoute);
    const uiSignals = await collectPageUiSignals(page);
    const phaseStagehandLogs = Array.isArray(stagehandLogs)
      ? stagehandLogs.slice(stagehandLogCursor)
      : [];
    const stagehand = summarizeStagehandPhaseLogs(phaseStagehandLogs, excludedAgentTools);
    const activeAppMatched = phase.expectedAppId
      ? uiSignals.activeAppId === phase.expectedAppId
      : true;
    const requiredUiStateMissing = (Array.isArray(phase.requiredUiSignals) ? phase.requiredUiSignals : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((signalName) => !uiSignals?.[signalName]);
    const proofRequirementsOk = proofRequirementMatches.length >= (Array.isArray(phase.proofRequirements) ? phase.proofRequirements.length : 0);
    const requiredUiStateOk = requiredUiStateMissing.length === 0;
    const surfaceMatched = phase.expectedRoute
      ? routeMatched
      : activeAppMatched;
    const locallyValidated = (
      (phase.minSignalMatches ?? 0) === 0
        ? surfaceMatched || hasMeaningfulVisibleText(visibleText)
        : validationMatches.length >= (phase.minSignalMatches ?? 0)
    ) && surfaceMatched && proofRequirementsOk && requiredUiStateOk && forbiddenPhraseMatches.length === 0;
    const quality = assessDemoScreenshotQuality({
      phaseId: phase.id,
      viewport: page.viewportSize() ?? { width: 1600, height: 1000 },
      screenshot,
      visibleText,
      validationMatches,
      minSignalMatches: phase.minSignalMatches ?? 0,
      proofRequirements: phase.proofRequirements,
      proofRequirementMatches,
      requiredUiSignals: phase.requiredUiSignals,
      routeMatched,
      activeAppMatched,
      uiSignals,
      forbiddenToolCalls: stagehand.forbiddenToolCalls,
      forbiddenPhrases: phase.forbiddenPhrases,
      forbiddenPhraseMatches,
    });

    return {
      screenshot,
      currentUrl,
      visibleText,
      validationMatches,
      proofRequirementMatches,
      proofRequirementsOk,
      requiredUiStateMissing,
      requiredUiStateOk,
      forbiddenPhraseMatches,
      routeMatched,
      activeAppMatched,
      locallyValidated,
      uiSignals,
      stagehand,
      quality,
    };
  }

  async function captureAttempt({ instruction, screenshotName, maxSteps }) {
    const startedAt = Date.now();
    let result = null;
    let error = null;
    const stagehandLogCursor = Array.isArray(stagehandLogs) ? stagehandLogs.length : 0;
    const controller = new AbortController();
    const phaseTimeoutMs = phase.id === "setup-state" ? 35_000 : 45_000;
    const phaseTimeout = setTimeout(() => controller.abort(), phaseTimeoutMs);
    const earlyStop = {
      triggered: false,
      reason: null,
      stepCount: 0,
      qualityScore: null,
      validationMatches: [],
      currentUrl: null,
    };

    try {
      result = await agent.execute({
        instruction,
        page,
        maxSteps,
        toolTimeout: 45_000,
        excludeTools: excludedAgentTools,
        signal: controller.signal,
        callbacks: {
          onStepFinish: async () => {
            if (controller.signal.aborted || earlyStop.triggered) {
              return;
            }
            earlyStop.stepCount += 1;
            const assessment = await assessPhaseState({
              settleMode: "checkpoint",
              stagehandLogCursor,
            });
            if (shouldStopAgentEarlyForProof({
              phase,
              assessment,
              stepCount: earlyStop.stepCount,
            })) {
              earlyStop.triggered = true;
              earlyStop.reason = "production-quality proof screen became visible during the phase";
              earlyStop.qualityScore = assessment.quality?.score ?? null;
              earlyStop.validationMatches = assessment.validationMatches;
              earlyStop.currentUrl = assessment.currentUrl;
              controller.abort(EARLY_STOP_REASON);
            }
          },
        },
      });
    } catch (phaseError) {
      error = phaseError instanceof Error ? phaseError.message : String(phaseError);
      if (String(controller.signal.reason || "") === EARLY_STOP_REASON) {
        error = null;
      } else if (/aborted|abort/i.test(error)) {
        error = `Phase timed out after ${phaseTimeoutMs}ms: ${error}`;
      }
    } finally {
      clearTimeout(phaseTimeout);
    }

    const screenshotPath = path.join(phasesDir, screenshotName);
    const assessment = await assessPhaseState({
      screenshotPath,
      settleMode: "full",
      stagehandLogCursor,
    });
    const endedAt = Date.now();

    return {
      id: phase.id,
      title: phase.title,
      required: phase.required,
      instruction,
      success: (Boolean(result?.success) || assessment.locallyValidated) && assessment.quality.ok,
      completed: Boolean(result?.completed) || assessment.locallyValidated,
      message: [
        result?.message ?? null,
        earlyStop.triggered
          ? `Runner stopped early after step ${earlyStop.stepCount} because a production-quality proof screen was already visible.`
          : null,
      ].filter(Boolean).join("\n\n") || null,
      actionCount: Array.isArray(result?.actions) ? result.actions.length : 0,
      actions: Array.isArray(result?.actions) ? result.actions : [],
      screenshot: {
        path: screenshotPath,
        ...assessment.screenshot,
      },
      currentUrl: assessment.currentUrl,
      visibleText: assessment.visibleText,
      validationSignals: phase.validationSignals ?? [],
      proofRequirements: phase.proofRequirements ?? [],
      requiredUiSignals: phase.requiredUiSignals ?? [],
      forbiddenPhrases: phase.forbiddenPhrases ?? [],
      validationMatches: assessment.validationMatches,
      proofRequirementMatches: assessment.proofRequirementMatches,
      proofRequirementsOk: assessment.proofRequirementsOk,
      requiredUiStateMissing: assessment.requiredUiStateMissing,
      requiredUiStateOk: assessment.requiredUiStateOk,
      forbiddenPhraseMatches: assessment.forbiddenPhraseMatches,
      routeMatched: assessment.routeMatched,
      activeAppMatched: assessment.activeAppMatched,
      locallyValidated: assessment.locallyValidated,
      uiSignals: assessment.uiSignals,
      stagehand: assessment.stagehand,
      quality: assessment.quality,
      earlyStop,
      error,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    };
  }

  const initialResult = await captureAttempt({
    instruction: phase.instruction,
    screenshotName: phase.screenshot,
    maxSteps: phase.id === "setup-state" ? 8 : 10,
  });

  let retryResult = null;
  if (shouldRetryPhaseForQuality(initialResult)) {
    retryResult = await captureAttempt({
      instruction: buildQualityRetryInstruction(phase, initialResult),
      screenshotName: phase.screenshot.replace(/\.png$/, "-retry.png"),
      maxSteps: 4,
    });
    retryResult.retry = {
      attempted: true,
      basedOnScore: initialResult.quality?.score ?? null,
      correctionPass: true,
    };
  }

  const selectedResult = await chooseBestPhaseResult({
    initialResult,
    retryResult,
  });
  selectedResult.attempts = [initialResult, retryResult].filter(Boolean).map((attempt) => ({
    screenshotPath: attempt.screenshot?.path,
    success: attempt.success,
    qualityScore: attempt.quality?.score ?? null,
    qualityOk: attempt.quality?.ok ?? null,
    validationMatches: attempt.validationMatches,
  }));

  return selectedResult;
}

async function buildStagehand(provider, viewport, cacheDir, logger) {
  const model = resolveAgentModelConfig();
  const useAdvancedStealth = isEnabled(process.env.AURA_DEMO_BROWSERBASE_ADVANCED_STEALTH);
  const common = {
    model,
    disableAPI: true,
    cacheDir: cacheDir || undefined,
    experimental: true,
    selfHeal: true,
    serverCache: false,
    verbose: 1,
    disablePino: true,
    logger,
  };

  if (provider === "browserbase") {
    const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("BROWSERBASE_API_KEY is required for Browserbase agent runs.");
    }

    return new Stagehand({
      ...common,
      env: "BROWSERBASE",
      apiKey,
      projectId: process.env.BROWSERBASE_PROJECT_ID?.trim() || undefined,
      keepAlive: true,
      browserbaseSessionCreateParams: {
        keepAlive: true,
        browserSettings: {
          ...(useAdvancedStealth ? { advancedStealth: true } : {}),
          solveCaptchas: true,
          viewport,
        },
      },
    });
  }

  return new Stagehand({
    ...common,
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: true,
      viewport,
    },
  });
}

function selectProvider(rawProvider) {
  const requested = String(rawProvider || "auto").trim().toLowerCase();
  if (requested === "browserbase" || requested === "local") {
    return requested;
  }
  return process.env.BROWSERBASE_API_KEY ? "browserbase" : "local";
}

const args = parseArgs(process.argv.slice(2));
const provider = selectProvider(args.provider);
const channel = String(args.channel || "nightly").trim();
const prompt = args.prompt ? String(args.prompt).trim() : "";
const baseUrl = String(
  args["base-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL || "http://127.0.0.1:5173",
).trim();
const profileId = String(args.profile || "agent-shell-explorer").trim();
const outputRoot = path.resolve(args["output-dir"] || path.join(process.cwd(), "output", "demo-screenshots"));
const profile = getDemoScreenshotProfile(profileId);
const changedFiles = await readChangedFiles(args);

if (!prompt && !args.changelog) {
  throw new Error("Pass either --prompt or --changelog so the agent has a story to demonstrate.");
}

const changelog = args.changelog
  ? await loadDemoScreenshotChangelog({
    changelog: String(args.changelog),
    channel,
  })
  : null;
const brief = await buildDemoAgentBrief({
  prompt,
  changelogDoc: changelog?.document ?? null,
  changedFiles,
});
const seedPlan = await buildDemoSeedPlan({
  brief,
  prompt,
  changelogDoc: changelog?.document ?? null,
  changedFiles,
});
const seededBrief = applyDemoSeedPlanToBrief(brief, seedPlan);
const seededProfile = applyDemoSeedPatch(profile, seedPlan);
const runId = [
  slugify(changelog?.document?.channel || channel),
  slugify(changelog?.document?.version || seededBrief.title || prompt || "agent-story"),
  slugify(seededBrief.targetAppId || seededProfile.id || "agent"),
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, ""),
].filter(Boolean).join("-");
const outputDir = path.join(outputRoot, runId);
const phasesDir = path.join(outputDir, "screenshots");
const stagehandCacheMode = resolveStagehandCacheMode(
  args["stagehand-cache-mode"] || process.env.AURA_DEMO_STAGEHAND_CACHE_MODE,
);
const cacheDir = resolveStagehandCacheDir({
  cacheMode: stagehandCacheMode,
  provider,
  targetAppId: seededBrief.targetAppId || "general",
  runId,
});
const excludedAgentTools = resolveExcludedAgentTools(args);

await ensureDirectory(outputDir);
await ensureDirectory(phasesDir);
if (cacheDir) {
  await ensureDirectory(cacheDir);
}

if (changelog) {
  await fs.writeFile(
    path.join(outputDir, changelog.format === "json" ? "changelog-source.json" : "changelog-source.md"),
    `${changelog.document.raw}\n`,
    "utf8",
  );
  await writeJson(path.join(outputDir, "changelog.json"), changelog.document);
}
await writeJson(path.join(outputDir, "story-brief.base.json"), brief);
await writeJson(path.join(outputDir, "seed-plan.json"), seedPlan);
await writeJson(path.join(outputDir, "story-brief.json"), seededBrief);
await writeJson(path.join(outputDir, "profile.json"), {
  id: seededProfile.id,
  title: seededProfile.title,
  description: seededProfile.description,
  mode: seededProfile.mode,
  baseEntryPath: profile.entryPath,
  entryPath: seededProfile.entryPath,
});

const consoleMessages = [];
const stagehandLogs = [];
const phases = buildPhasePlan(seededBrief);
const stagehand = await buildStagehand(
  provider,
  seededProfile.viewport ?? { width: 1600, height: 1000 },
  cacheDir,
  (logLine) => {
    stagehandLogs.push(normalizeStagehandLogLine(logLine));
  },
);
let browser = null;

try {
  await stagehand.init();
  browser = await chromium.connectOverCDP(stagehand.connectURL());
  const context = browser.contexts()[0] ?? await browser.newContext({ viewport: seededProfile.viewport });
  const page = await context.newPage();
  const viewport = seededProfile.viewport ?? { width: 1600, height: 1000 };
  await page.setViewportSize(viewport);

  page.on("console", (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`);
  });

  await installBootAuth(page, seededProfile.session);
  await installSeedRoutes(page, seededProfile);
  const initialNavigationUrl = new URL("/", baseUrl).toString();
  await page.goto(initialNavigationUrl, {
    waitUntil: "domcontentloaded",
  });
  await waitForUiToSettle(page);
  await waitForCaptureBridge(page).catch(() => {});
  const bootstrapBridge = await resetBootstrapShellWithBridge(page, seededBrief, consoleMessages);
  let bootstrapRecovery = {
    recovered: false,
    initial: await collectBootstrapAssessment(page),
    fallback: null,
  };
  let bootstrapPriming = {
    attempted: false,
    reason: bootstrapBridge.success ? "not-needed" : "bridge-incomplete",
    success: bootstrapBridge.success,
    currentUrl: page.url(),
  };

  if (!bootstrapBridge.success) {
    const fallbackNavigationUrl = new URL(
      seededBrief.startPath || seededProfile.entryPath || "/desktop",
      baseUrl,
    ).toString();
    if (page.url() !== fallbackNavigationUrl) {
      await page.goto(fallbackNavigationUrl, {
        waitUntil: "domcontentloaded",
      });
      await waitForUiToSettle(page);
    }
    bootstrapRecovery = await recoverBootstrapRouteMiss(page, baseUrl, fallbackNavigationUrl, consoleMessages);
    bootstrapPriming = bootstrapRecovery.recovered
      ? await maybePrimeTargetAppFromLauncher(page, seededBrief, consoleMessages)
      : {
        attempted: false,
        reason: "not-needed",
        success: false,
        currentUrl: page.url(),
      };
  }

  const agent = stagehand.agent({
    mode: "dom",
    model: resolveAgentModelConfig(),
    systemPrompt: seededBrief.systemPrompt,
  });

  const phaseResults = [];
  for (const phase of phases) {
    const previousPhase = phaseResults.at(-1) ?? null;
    const phaseResult = shouldEarlyExitCapturePhase({ phase, previousPhase })
      ? await buildEarlyExitPhaseResult({
        phase,
        previousPhase,
        phasesDir,
      })
      : await runAgentPhase({
        agent,
        page,
        phase,
        phasesDir,
        excludedAgentTools,
        stagehandLogs,
      });
    if (shouldReusePreviousPhaseScreenshot(phaseResult, previousPhase)) {
      await applyOptionalPhaseFallback(phaseResult, previousPhase);
    }
    phaseResults.push(phaseResult);
    await writeJson(path.join(outputDir, `${phase.id}.json`), phaseResult);
  }

  let repair = {
    attempted: false,
    success: false,
    steps: [],
    screenshot: null,
  };
  if (shouldAttemptFeedbackRepair(seededBrief)) {
    repair = await runFeedbackRepair(page, seededBrief, phasesDir);
  } else if (shouldAttemptAgentRepair(seededBrief)) {
    repair = await runAgentRepair(page, phasesDir);
  }
  const currentUrl = page.url();
  const visibleText = clipText(await page.locator("body").innerText().catch(() => ""), 2500);
  const history = await stagehand.history.catch(() => []);
  const requiredPhaseSuccess = phaseResults.filter((phase) => phase.required).every((phase) => phase.success);
  const screenshots = repair.screenshot
    ? [...phaseResults.map((phase) => phase.screenshot), repair.screenshot]
    : phaseResults.map((phase) => phase.screenshot);
  const summary = {
    ok: requiredPhaseSuccess || repair.success,
    generatedAt: new Date().toISOString(),
    provider,
    baseUrl,
    outputDir,
    profileId: seededProfile.id,
    storyTitle: seededBrief.title,
    story: seededBrief.story,
    targetAppId: seededBrief.targetAppId,
    targetAppLabel: seededBrief.targetAppLabel,
    briefGenerator: seededBrief.generator,
    briefConfidence: seededBrief.confidence,
    desktopOnly: seededBrief.desktopOnly !== false,
    rationale: seededBrief.rationale,
    successChecklist: seededBrief.successChecklist,
    setupPlan: seededBrief.setupPlan ?? [],
    validationSignals: seededBrief.validationSignals ?? [],
    changedFiles,
    source: changelog?.source ?? (prompt ? "prompt" : null),
    stagehandCacheMode,
    excludedAgentTools,
    seedPlanStatus: seedPlan.status,
    seedPlanStrategy: seedPlan.strategy,
    seedPlanCapabilityId: seedPlan.capabilityId,
    seedPlanSupportLevel: seedPlan.supportLevel,
    seedPlanRationale: seedPlan.rationale,
    seedPlanCoverageGaps: seedPlan.coverageGaps,
    seedPlanSeededEntities: seedPlan.seededEntities,
    seedPlanScoredCapabilities: seedPlan.scoredCapabilities,
    inspectorUrl: stagehand.browserbaseSessionURL || null,
    sessionId: stagehand.browserbaseSessionID || null,
    bootstrapBridge,
    bootstrapRecovery,
    bootstrapPriming,
    currentUrl,
    visibleText,
    screenshots,
    phases: phaseResults.map((phase) => ({
      id: phase.id,
      title: phase.title,
      required: phase.required,
      skipped: Boolean(phase.skipped),
      skipReason: phase.skipReason ?? null,
      earlyExit: phase.earlyExit ?? null,
      success: phase.success,
      completed: phase.completed,
      message: phase.message,
      error: phase.error,
      actionCount: phase.actionCount,
      screenshot: phase.screenshot,
      currentUrl: phase.currentUrl,
      validationSignals: phase.validationSignals,
      validationMatches: phase.validationMatches,
      routeMatched: phase.routeMatched,
      activeAppMatched: phase.activeAppMatched,
      locallyValidated: phase.locallyValidated,
      uiSignals: phase.uiSignals,
      stagehand: phase.stagehand ?? null,
      earlyStop: phase.earlyStop ?? null,
      quality: phase.quality,
      attempts: phase.attempts,
      durationMs: phase.durationMs,
    })),
    repair,
    cacheDir,
    historyLength: Array.isArray(history) ? history.length : 0,
    stagehandLogCount: stagehandLogs.length,
  };

  await writeJson(path.join(outputDir, "agent-history.json"), history);
  await writeJson(path.join(outputDir, "agent-phases.json"), phaseResults);
  await writeJson(path.join(outputDir, "stagehand-logs.json"), stagehandLogs);
  await writeJson(path.join(outputDir, "production-summary.json"), summary);
  await writeText(path.join(outputDir, "console.log"), `${consoleMessages.join("\n")}\n`);

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser?.close().catch(() => {});
  await stagehand.close().catch(() => {});
}
