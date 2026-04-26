import fs from "node:fs";
import path from "node:path";

import { buildCaptureLoginUrl, readPngDimensions } from "../changelog-media-browser-use-trial.mjs";

export const DEFAULT_HIGH_RES_CAPTURE_VIEWPORT = Object.freeze({
  width: 1280,
  height: 720,
  deviceScaleFactor: 2,
});

export const CHANGELOG_CAPTURE_PRESENTATION_CSS = `
  body[data-aura-changelog-capture-presentation="true"] {
    --color-text: #f7f8fb !important;
    --color-text-primary: #f7f8fb !important;
    --color-text-secondary: rgba(247, 248, 251, 0.8) !important;
    --color-text-muted: rgba(247, 248, 251, 0.66) !important;
    --color-border: rgba(255, 255, 255, 0.14) !important;
    --color-border-subtle: rgba(255, 255, 255, 0.1) !important;
    --color-bg-secondary: #1a1a1a !important;
    --color-bg-tertiary: rgba(255, 255, 255, 0.075) !important;
  }
  body[data-aura-changelog-capture-presentation="true"] [data-agent-surface],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-context],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-action],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-field] {
    filter: none !important;
  }
  body[data-aura-changelog-capture-presentation="true"] [data-agent-surface] {
    color: var(--color-text-secondary) !important;
  }
  body[data-aura-changelog-capture-presentation="true"] [data-agent-proof],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-action],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-model-label] {
    color: var(--color-text) !important;
  }
  body[data-aura-changelog-capture-presentation="true"] [data-agent-model-label],
  body[data-aura-changelog-capture-presentation="true"] [data-agent-proof] button {
    font-weight: 500 !important;
  }
`;

function commonChromeExecutablePath() {
  const candidates = [
    process.env.AURA_CHANGELOG_MEDIA_CHROME_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function launchChromium(chromium, { headless = true } = {}) {
  const executablePath = commonChromeExecutablePath();
  try {
    return await chromium.launch({
      headless,
      ...(executablePath ? { executablePath } : {}),
    });
  } catch (error) {
    if (executablePath) {
      throw error;
    }
    throw new Error(
      `High-resolution capture could not launch Chromium. Install Playwright browsers or set AURA_CHANGELOG_MEDIA_CHROME_EXECUTABLE. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function normalizeTargetPath(targetPath) {
  const raw = String(targetPath || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/desktop";
  return raw;
}

function buildCaptureOutput({ targetAppId, targetPath, bridgeResult, pageText, proofText }) {
  const ok = Boolean(bridgeResult?.ok);
  const focusedProofText = String(proofText || pageText || "").replace(/\s+/g, " ").trim();
  return {
    shouldCapture: ok,
    targetAppId: targetAppId || bridgeResult?.targetAppId || null,
    targetPath: targetPath || bridgeResult?.targetPath || null,
    proofSurface: bridgeResult?.state?.activeAppLabel || targetAppId || null,
    proofVisible: ok,
    visibleProof: ok && focusedProofText
      ? [focusedProofText.slice(0, 280)]
      : [],
    screenshotDescription: ok
      ? `High-resolution Aura desktop capture for ${targetAppId || "the target app"} at ${targetPath || "the target route"}.`
      : "High-resolution Aura capture could not reach a stable desktop product screen.",
    desktopLayoutVisible: Boolean(bridgeResult?.state?.shellVisible),
    mobileLayoutVisible: false,
    concerns: ok ? [] : [
      "High-resolution capture bridge did not reach the requested desktop product screen.",
    ],
  };
}

function storyTokens(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9. -]+/g, " ")
    .split(/[\s-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))];
}

function seedPlanCaptureText(seedPlan = null) {
  if (!seedPlan || typeof seedPlan !== "object") return "";
  return [
    ...(Array.isArray(seedPlan.capabilities) ? seedPlan.capabilities : []),
    ...(Array.isArray(seedPlan.requiredState) ? seedPlan.requiredState : []),
    ...(Array.isArray(seedPlan.proofBoundary) ? seedPlan.proofBoundary : []),
    ...(Array.isArray(seedPlan.contextBoundary) ? seedPlan.contextBoundary : []),
    ...(Array.isArray(seedPlan.readinessSignals) ? seedPlan.readinessSignals : []),
    seedPlan.notes,
  ].filter(Boolean).join("\n");
}

function shouldPreferStableShellProof(seedPlan = null, story = "") {
  const seedText = seedPlanCaptureText(seedPlan).toLowerCase();
  const storyText = String(story || "").toLowerCase();
  const capabilityText = Array.isArray(seedPlan?.capabilities) ? seedPlan.capabilities.join("\n").toLowerCase() : "";
  const wantsShellProof = /\b(?:shell-context-populated|desktop shell|shell chrome|bottom taskbar|taskbar|floating[- ]glass|floating panel|desktop layout)\b/.test(`${seedText}\n${storyText}`);
  const wantsInteractiveProof = /\b[a-z0-9-]+-open\b/.test(capabilityText);
  return wantsShellProof && !wantsInteractiveProof;
}

async function prepareProofState(page, story, seedPlan = null) {
  if (shouldPreferStableShellProof(seedPlan, story)) {
    return null;
  }
  const tokens = storyTokens(story);
  if (!tokens.length) return null;
  const proofTokens = tokens.filter((token) => (
    /\d/.test(token)
    || token.length >= 6
  ) && ![
    "model",
    "picker",
    "available",
    "directly",
    "option",
    "selectable",
    "visible",
    "showing",
    "composer",
  ].includes(token));
  const selected = await page.evaluate((candidateTokens) => {
    function visible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.05;
    }
    const actions = Array.from(document.querySelectorAll("[data-agent-action], button, [role='button']"))
      .filter(visible)
      .map((element) => {
        const action = element.getAttribute("data-agent-action") || "";
        const label = element.getAttribute("aria-label") || "";
        const text = element.textContent || "";
        const haystack = `${action} ${label} ${text}`.toLowerCase();
        const tokenScore = candidateTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
        const actionBonus = action ? 8 : 0;
        const score = tokenScore + actionBonus;
        return { element, action, label, text: text.trim(), score, tokenScore };
      })
      .filter((entry) => entry.tokenScore > 0)
      .sort((a, b) => b.score - a.score);
    const best = actions[0];
    if (!best || best.score < 2) return null;
    if (!best.action) {
      best.element.click();
    }
    return {
      action: best.action || null,
      label: best.label || null,
      text: best.text || null,
      score: best.score,
      clickedInPage: !best.action,
    };
  }, tokens);
  if (selected?.action) {
    const actionSelector = `[data-agent-action="${selected.action}"]`;
    await page.locator(actionSelector).first().click({ timeout: 2000 }).catch(async () => {
      await page.evaluate((selector) => {
        const element = Array.from(document.querySelectorAll(selector)).find((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity || 1) > 0.05;
        });
        if (element instanceof HTMLElement) element.click();
      }, actionSelector).catch(() => null);
    });
  }
  if (selected) {
    await page.waitForTimeout(350);
    await page.evaluate((desiredTokens) => {
      if (!desiredTokens.length) return;
      const visibleText = Array.from(document.querySelectorAll("[data-agent-proof], [data-agent-model-label]"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity || 1) > 0.05;
        })
        .map((element) => `${element.getAttribute("data-agent-model-label") || ""} ${element.textContent || ""}`)
        .join(" ")
        .toLowerCase();
      const proofAlreadyVisible = desiredTokens.some((token) => visibleText.includes(token));
      const proofIsCompactTeaser = visibleText.length < 180;
      if (proofAlreadyVisible && !proofIsCompactTeaser) return;
      const showMoreButton = Array.from(document.querySelectorAll("button, [role='button']"))
        .find((element) => /show all(?:\s+\w+)?|more/i.test(element.textContent || ""));
      if (showMoreButton instanceof HTMLElement) {
        showMoreButton.click();
      }
    }, proofTokens).catch(() => null);
    await page.waitForTimeout(250);
    await page.evaluate((desiredTokens) => {
      if (!desiredTokens.length) return;
      const matches = Array.from(document.querySelectorAll("[data-agent-model-label]"))
        .map((element) => {
          const label = `${element.getAttribute("data-agent-model-label") || ""} ${element.textContent || ""}`.toLowerCase();
          const score = desiredTokens.reduce((total, token) => total + (label.includes(token) ? 1 : 0), 0);
          return { element, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = matches[0]?.element;
      if (best instanceof HTMLElement) {
        best.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }, proofTokens).catch(() => null);
    await page.waitForTimeout(250);
    await page.waitForSelector("[data-agent-surface]", { state: "visible", timeout: 1500 }).catch(() => null);
  }
  return selected;
}

async function applyCapturePresentationMode(page) {
  await page.evaluate(({ css }) => {
    document.body.setAttribute("data-aura-changelog-capture-presentation", "true");
    document.getElementById("aura-changelog-capture-style")?.remove();
    const style = document.createElement("style");
    style.id = "aura-changelog-capture-style";
    style.textContent = css;
    document.head.appendChild(style);
  }, {
    css: CHANGELOG_CAPTURE_PRESENTATION_CSS,
  });
  await page.waitForTimeout(250);
  return { presentation: true };
}

async function selectProofClip(page) {
  return page.evaluate(() => {
    const targetHeight = Math.min(window.innerHeight, Math.round(window.innerWidth * 9 / 16));
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: targetHeight,
      sourceSelector: "viewport-full-desktop-proof",
      sourceText: document.body.innerText.slice(0, 500),
    };
  });
}

export async function captureHighResolutionAuraProof({
  baseUrl,
  apiBaseUrl = "",
  captureSession,
  targetPath = "/desktop",
  targetAppId = null,
  outputPath,
  viewport = DEFAULT_HIGH_RES_CAPTURE_VIEWPORT,
  story = "",
  seedPlan = null,
  waitAfterResetMs = 700,
  playwright = null,
} = {}) {
  if (!baseUrl) {
    return {
      ok: false,
      status: "failed",
      concerns: ["High-resolution capture requires a baseUrl."],
    };
  }
  if (!captureSession?.access_token) {
    return {
      ok: false,
      status: "failed",
      concerns: ["High-resolution capture requires a seeded capture session."],
    };
  }
  if (!outputPath) {
    return {
      ok: false,
      status: "failed",
      concerns: ["High-resolution capture requires an outputPath."],
    };
  }

  const resolvedTargetPath = normalizeTargetPath(targetPath);
  const resolvedViewport = {
    width: Number.isFinite(Number(viewport?.width)) ? Number(viewport.width) : DEFAULT_HIGH_RES_CAPTURE_VIEWPORT.width,
    height: Number.isFinite(Number(viewport?.height)) ? Number(viewport.height) : DEFAULT_HIGH_RES_CAPTURE_VIEWPORT.height,
    deviceScaleFactor: Number.isFinite(Number(viewport?.deviceScaleFactor))
      ? Number(viewport.deviceScaleFactor)
      : DEFAULT_HIGH_RES_CAPTURE_VIEWPORT.deviceScaleFactor,
  };

  let browser = null;
  try {
    const playwrightModule = playwright || await import("playwright");
    const chromium = playwrightModule.chromium;
    browser = await launchChromium(chromium);
    const page = await browser.newPage({
      viewport: {
        width: resolvedViewport.width,
        height: resolvedViewport.height,
      },
      deviceScaleFactor: resolvedViewport.deviceScaleFactor,
    });
    const loginUrl = buildCaptureLoginUrl(baseUrl, resolvedTargetPath, apiBaseUrl, captureSession);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => Boolean(window.__AURA_CAPTURE_BRIDGE__),
      null,
      { timeout: 20_000 },
    );
    const bridgeResult = await page.evaluate(
      ({ appId, path: routePath, seed }) => window.__AURA_CAPTURE_BRIDGE__.resetShell({
        targetAppId: appId,
        targetPath: routePath,
        seedPlan: seed,
        sidekickCollapsed: false,
        timeoutMs: 10_000,
      }),
      { appId: targetAppId, path: resolvedTargetPath, seed: seedPlan },
    );
    await page.waitForTimeout(waitAfterResetMs);
    const appliedCapturePresentationMode = await applyCapturePresentationMode(page);
    await page.waitForSelector("[data-agent-surface], [data-agent-action]", { state: "visible", timeout: 5000 }).catch(() => null);
    const proofAction = await prepareProofState(page, story, seedPlan);
    await page.waitForTimeout(450);
    const clip = await selectProofClip(page, story, proofAction, seedPlan);
    const pageState = await page.evaluate(() => ({
      url: window.location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      capturePresentation: document.body.getAttribute("data-aura-changelog-capture-presentation") === "true",
      text: document.body.innerText.slice(0, 2000),
      bridgeState: window.__AURA_CAPTURE_BRIDGE__?.getState?.() || null,
    }));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      clip,
      type: "png",
      scale: "device",
      animations: "disabled",
      caret: "hide",
    });
    const buffer = fs.readFileSync(outputPath);
    const dimensions = readPngDimensions(buffer);
    const output = buildCaptureOutput({
      targetAppId,
      targetPath: resolvedTargetPath,
      bridgeResult,
      pageText: pageState.text,
      proofText: clip?.sourceText,
    });

    return {
      ok: Boolean(bridgeResult?.ok && dimensions),
      status: bridgeResult?.ok && dimensions ? "captured" : "rejected",
      provider: "aura-high-res-browser-camera",
      viewport: resolvedViewport,
      capturePresentationMode: appliedCapturePresentationMode,
      pageState,
      bridgeResult,
      proofAction,
      clip,
      output,
      screenshot: {
        path: outputPath,
        bytes: buffer.length,
        dimensions,
      },
      concerns: bridgeResult?.ok ? [] : output.concerns,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      provider: "aura-high-res-browser-camera",
      viewport: resolvedViewport,
      concerns: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}
