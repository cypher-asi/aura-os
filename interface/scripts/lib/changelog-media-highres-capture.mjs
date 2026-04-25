import fs from "node:fs";
import path from "node:path";

import { buildCaptureLoginUrl, readPngDimensions } from "../changelog-media-browser-use-trial.mjs";

export const DEFAULT_HIGH_RES_CAPTURE_VIEWPORT = Object.freeze({
  width: 2560,
  height: 1440,
  deviceScaleFactor: 3,
});

export const DEFAULT_CHANGELOG_CAPTURE_ZOOM = 1;
export const DEFAULT_CHANGELOG_CAPTURE_TEXT_SCALE = 1.45;

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

function buildCaptureOutput({ targetAppId, targetPath, bridgeResult, pageText }) {
  const ok = Boolean(bridgeResult?.ok);
  const proofText = String(pageText || "").replace(/\s+/g, " ").trim();
  return {
    shouldCapture: ok,
    targetAppId: targetAppId || bridgeResult?.targetAppId || null,
    targetPath: targetPath || bridgeResult?.targetPath || null,
    proofSurface: bridgeResult?.state?.activeAppLabel || targetAppId || null,
    proofVisible: ok,
    visibleProof: ok && proofText
      ? [proofText.slice(0, 280)]
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

async function prepareProofState(page, story) {
  const tokens = storyTokens(story);
  if (!tokens.length) return null;
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
        return { element, action, label, text: text.trim(), score };
      })
      .filter((entry) => entry.score > 0)
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
    await page.waitForSelector("[data-agent-surface]", { state: "visible", timeout: 1500 }).catch(() => null);
  }
  return selected;
}

async function applyCapturePresentationMode(
  page,
  {
    zoom = DEFAULT_CHANGELOG_CAPTURE_ZOOM,
    textScale = DEFAULT_CHANGELOG_CAPTURE_TEXT_SCALE,
  } = {},
) {
  const resolvedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : DEFAULT_CHANGELOG_CAPTURE_ZOOM;
  const clampedZoom = Math.min(1.75, Math.max(1, resolvedZoom));
  const resolvedTextScale = Number.isFinite(Number(textScale)) ? Number(textScale) : DEFAULT_CHANGELOG_CAPTURE_TEXT_SCALE;
  const clampedTextScale = Math.min(1.8, Math.max(1, resolvedTextScale));
  await page.evaluate(({ zoomValue, textScaleValue }) => {
    document.documentElement.style.setProperty("--aura-changelog-capture-zoom", String(zoomValue));
    document.documentElement.style.setProperty("--aura-changelog-capture-text-scale", String(textScaleValue));
    document.body.style.zoom = zoomValue > 1 ? String(zoomValue) : "";
    document.body.setAttribute("data-aura-changelog-capture-zoom", String(zoomValue));
    document.body.setAttribute("data-aura-changelog-capture-text-scale", String(textScaleValue));
    document.getElementById("aura-changelog-capture-style")?.remove();
    const style = document.createElement("style");
    style.id = "aura-changelog-capture-style";
    style.textContent = `
      body[data-aura-changelog-capture-text-scale] [data-agent-context-anchor],
      body[data-aura-changelog-capture-text-scale] [data-agent-context-anchor] * {
        font-size: calc(16px * var(--aura-changelog-capture-text-scale)) !important;
        line-height: 1.15 !important;
        font-weight: 600 !important;
        text-rendering: geometricPrecision !important;
        -webkit-font-smoothing: antialiased !important;
      }
      body[data-aura-changelog-capture-text-scale] [data-agent-proof]:not(img):not(svg):not(canvas),
      body[data-aura-changelog-capture-text-scale] [data-agent-proof]:not(img):not(svg):not(canvas) * {
        text-rendering: geometricPrecision !important;
        -webkit-font-smoothing: antialiased !important;
      }
      body[data-aura-changelog-capture-text-scale] [data-agent-proof] button,
      body[data-aura-changelog-capture-text-scale] [data-agent-proof] [role="menuitem"],
      body[data-aura-changelog-capture-text-scale] [data-agent-proof] [data-agent-model-label] {
        font-size: calc(13px * var(--aura-changelog-capture-text-scale)) !important;
        line-height: 1.2 !important;
      }
      body[data-aura-changelog-capture-text-scale] [data-agent-action],
      body[data-aura-changelog-capture-text-scale] [data-agent-field],
      body[data-aura-changelog-capture-text-scale] input,
      body[data-aura-changelog-capture-text-scale] button {
        text-rendering: geometricPrecision !important;
        -webkit-font-smoothing: antialiased !important;
      }
    `;
    document.head.appendChild(style);
  }, { zoomValue: clampedZoom, textScaleValue: clampedTextScale });
  await page.waitForTimeout(250);
  return { zoom: clampedZoom, textScale: clampedTextScale };
}

async function selectProofClip(page, story, proofAction = null, seedPlan = null) {
  const captureContract = [
    story,
    seedPlanCaptureText(seedPlan),
    "proof plus recognizable product context",
    "nearest product title tab sidebar toolbar navigation selected project active panel",
  ].filter(Boolean).join("\n");
  return page.evaluate(({ tokens, actionName }) => {
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.05;
    }
    function rectFor(selector, { required = true } = {}) {
      const element = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (!element || !isVisible(element)) {
        return required ? null : null;
      }
      return rectForElement(element, selector);
    }
    function rectForElement(element, selector) {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        selector,
        text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
      };
    }
    function tokenScoreFor(text) {
      const haystack = String(text || "").toLowerCase();
      return tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    }
    function union(rects) {
      const visibleRects = rects.filter(Boolean);
      if (!visibleRects.length) return null;
      const x = Math.min(...visibleRects.map((rect) => rect.x));
      const y = Math.min(...visibleRects.map((rect) => rect.y));
      const right = Math.max(...visibleRects.map((rect) => rect.right));
      const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
      return {
        x,
        y,
        right,
        bottom,
        width: right - x,
        height: bottom - y,
        selector: visibleRects.map((rect) => rect.selector).join(", "),
        text: visibleRects.map((rect) => rect.text || "").filter(Boolean).join(" ").slice(0, 500),
      };
    }
    function contextCreatesMostlyEmptyFrame(contextRect, proofRect) {
      const combined = union([contextRect, proofRect]);
      if (!combined) return false;
      const combinedArea = Math.max(1, combined.width * combined.height);
      const contentArea = Math.max(1, (contextRect.width * contextRect.height) + (proofRect.width * proofRect.height));
      const emptyRatio = 1 - Math.min(1, contentArea / combinedArea);
      const verticalGap = Math.max(0, proofRect.y - contextRect.bottom, contextRect.y - proofRect.bottom);
      const horizontalGap = Math.max(0, proofRect.x - contextRect.right, contextRect.x - proofRect.right);
      const farVerticalContext = verticalGap > Math.max(240, proofRect.height * 0.5);
      const farHorizontalContext = horizontalGap > Math.max(320, proofRect.width * 0.5);
      return emptyRatio > 0.55 && (farVerticalContext || farHorizontalContext);
    }
    function expandToPresentationClip(rect, { minWidth = 1920, minHeight = 1080, maxWidth = null, maxHeight = null, alignTop = false } = {}) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const targetRatio = 16 / 9;
      const padding = 48;
      let width = Math.max(rect.width + (padding * 2), minWidth);
      let height = Math.max(rect.height + (padding * 2), minHeight);
      if (width / height > targetRatio) {
        height = width / targetRatio;
      } else {
        width = height * targetRatio;
      }
      if (maxWidth && width > maxWidth) {
        width = maxWidth;
        height = width / targetRatio;
      }
      if (maxHeight && height > maxHeight) {
        height = maxHeight;
        width = height * targetRatio;
      }
      width = Math.min(width, viewportWidth);
      height = Math.min(height, viewportHeight);
      let x = alignTop ? rect.x - padding : rect.x + (rect.width / 2) - (width / 2);
      let y = alignTop ? rect.y - padding : rect.y + (rect.height / 2) - (height / 2);
      x = Math.max(0, Math.min(x, viewportWidth - width));
      y = Math.max(0, Math.min(y, viewportHeight - height));
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        sourceSelector: rect.selector,
        sourceText: rect.text || "",
      };
    }
    function dataAgentKeywords(element) {
      return [
        element.getAttribute("data-agent-context"),
        element.getAttribute("data-agent-context-anchor"),
        element.getAttribute("data-agent-surface"),
        element.getAttribute("data-agent-proof"),
        element.getAttribute("data-agent-action"),
        element.getAttribute("data-agent-field"),
        element.getAttribute("data-agent-model-id"),
        element.getAttribute("data-agent-model-label"),
        element.getAttribute("aria-label"),
      ].filter(Boolean).join(" ");
    }
    function scoreSurface(surface, rect) {
      const haystack = `${surface.selector} ${surface.semanticText || ""} ${rect.text || ""}`.toLowerCase();
      const tokenScore = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      const visibleTextBonus = rect.text ? 0.5 : 0;
      const proofBonus = surface.directProofSignal ? 8 : surface.hasProofSignal ? 3 : 0;
      const semanticBonus = surface.semanticText ? 1 : 0;
      const productContextBonus = surface.inProductContext ? 4 : 0;
      const supportPanelPenalty = !surface.inProductContext && surface.hasProofSignal ? -3 : 0;
      const mainPanelPenalty = surface.name === "main-panel" ? -0.5 : 0;
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const areaRatio = (rect.width * rect.height) / viewportArea;
      return tokenScore
        + visibleTextBonus
        + proofBonus
        + semanticBonus
        + productContextBonus
        + supportPanelPenalty
        + mainPanelPenalty
        - (areaRatio * 4);
    }

    function contextRectForProofElement(element) {
      if (!element.getAttribute("data-agent-proof")) return null;
      const proofRect = rectForElement(
        element,
        `[data-agent-proof="${CSS.escape(element.getAttribute("data-agent-proof") || "proof")}"]`,
      );
      const explicitContext = element.closest("[data-agent-context]");
      if (explicitContext && isVisible(explicitContext)) {
        const anchors = Array.from(explicitContext.querySelectorAll("[data-agent-context-anchor]"))
          .filter(isVisible)
          .map((anchor) => rectForElement(
            anchor,
            `[data-agent-context-anchor="${CSS.escape(anchor.getAttribute("data-agent-context-anchor") || "context-anchor")}"]`,
          ));
        if (anchors.length) {
          const nearbyAnchors = anchors.filter((anchor) => !contextCreatesMostlyEmptyFrame(anchor, proofRect));
          const contextAnchorRect = union(nearbyAnchors);
          if (contextAnchorRect) return contextAnchorRect;
        }
        const rect = explicitContext.getBoundingClientRect();
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const contextAreaRatio = (rect.width * rect.height) / viewportArea;
        if (contextAreaRatio <= 0.5) {
          return rectForElement(
            explicitContext,
            `[data-agent-context="${CSS.escape(explicitContext.getAttribute("data-agent-context") || "proof-context")}"]`,
          );
        }
      }
      const context = element.parentElement?.closest("[data-agent-surface]:not([data-agent-proof])");
      if (!context || !isVisible(context)) return null;
      return rectForElement(context, `[data-agent-surface="${CSS.escape(context.getAttribute("data-agent-surface") || "proof-context")}"]`);
    }

    const proofSurfaces = Array.from(document.querySelectorAll("[data-agent-surface], [data-agent-context]"))
      .filter(isVisible)
      .map((element, index) => {
        const surface = element.getAttribute("data-agent-surface")
          || element.getAttribute("data-agent-context")
          || `surface-${index + 1}`;
        return {
          selector: element.getAttribute("data-agent-surface")
            ? `[data-agent-surface="${CSS.escape(surface)}"]`
            : `[data-agent-context="${CSS.escape(surface)}"]`,
          name: surface,
          semanticText: dataAgentKeywords(element),
          directProofSignal: Boolean(element.getAttribute("data-agent-proof")),
          hasProofSignal: Boolean(element.querySelector("[data-agent-proof]") || element.getAttribute("data-agent-proof")),
          inProductContext: Boolean(element.closest("[data-agent-context]")),
          contextRect: contextRectForProofElement(element),
        };
      });
    const semanticProofElements = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const area = rect.width * rect.height;
        const viewportArea = window.innerWidth * window.innerHeight;
        const tokenScore = tokenScoreFor(`${dataAgentKeywords(element)} ${text}`);
        return {
          element,
          selector: `semantic-proof-${index + 1}`,
          tokenScore,
          area,
          viewportArea,
          text,
        };
      })
      .filter((entry) => (
        entry.tokenScore > 0
        && entry.text.length >= 12
        && entry.area >= 8000
        && entry.area <= entry.viewportArea * 0.72
      ));

    const ranked = [];
    for (const surface of proofSurfaces) {
      const rect = rectFor(surface.selector);
      if (!rect) continue;
      const included = [rect];
      if (actionName) {
        included.push(rectFor(`[data-agent-action="${CSS.escape(actionName)}"]`, { required: false }));
      }
      if (surface.directProofSignal) {
        included.push(surface.contextRect);
      }
      const combined = union(included) || rect;
      const directProofContextFitsFocusFrame = surface.directProofSignal
        && surface.inProductContext
        && combined.width + 96 <= 1440
        && combined.height + 96 <= 810;
      ranked.push({
        surface,
        rect: combined,
        score: scoreSurface(surface, combined),
        minWidth: surface.directProofSignal ? 1280 : 1920,
        minHeight: surface.directProofSignal ? 720 : 1080,
        maxWidth: directProofContextFitsFocusFrame ? 1440 : null,
        maxHeight: directProofContextFitsFocusFrame ? 810 : null,
        alignTop: directProofContextFitsFocusFrame,
      });
    }
    if (actionName) {
      const actionRect = rectFor(`[data-agent-action="${CSS.escape(actionName)}"]`, { required: false });
      if (actionRect) {
        ranked.push({
          surface: {
            name: "semantic-action-proof",
            semanticText: actionRect.text || actionName,
          },
          rect: actionRect,
          score: tokenScoreFor(`${actionName} ${actionRect.text || ""}`) * 5 + 4,
          minWidth: 1280,
          minHeight: 720,
        });
      }
    }
    for (const semantic of semanticProofElements) {
      const rect = rectForElement(semantic.element, semantic.selector);
      const areaRatio = semantic.area / semantic.viewportArea;
      const compactBonus = areaRatio < 0.18 ? 2 : areaRatio < 0.35 ? 1 : 0;
      const score = (semantic.tokenScore * 4)
        + compactBonus
        + (semantic.text.length > 24 ? 0.5 : 0)
        - (areaRatio * 4);
      if (score <= 0) continue;
      ranked.push({
        surface: {
          name: "semantic-proof",
          semanticText: semantic.text.slice(0, 500),
        },
        rect,
        score,
        minWidth: 1440,
        minHeight: 810,
      });
    }
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const areaA = a.rect.width * a.rect.height;
      const areaB = b.rect.width * b.rect.height;
      return areaA - areaB;
    });
    const directProofRanked = ranked.filter((entry) => entry.surface.directProofSignal);
    const contextualProofRanked = ranked.filter((entry) => entry.surface.hasProofSignal);
    const best = directProofRanked[0]
      || contextualProofRanked[0]
      || ranked.find((entry) => entry.score >= 1)
      || ranked[0];
    if (best) {
      return expandToPresentationClip(best.rect, {
        minWidth: best.minWidth || 1920,
        minHeight: best.minHeight || 1080,
        maxWidth: best.maxWidth || null,
        maxHeight: best.maxHeight || null,
        alignTop: best.alignTop || false,
      });
    }
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: Math.round(window.innerWidth * 9 / 16),
      sourceSelector: "viewport",
      sourceText: document.body.innerText.slice(0, 500),
    };
  }, { tokens: storyTokens(captureContract), actionName: proofAction?.action || "" });
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
  captureZoom = DEFAULT_CHANGELOG_CAPTURE_ZOOM,
  captureTextScale = DEFAULT_CHANGELOG_CAPTURE_TEXT_SCALE,
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
    const appliedCapturePresentationMode = await applyCapturePresentationMode(page, {
      zoom: captureZoom,
      textScale: captureTextScale,
    });
    await page.waitForSelector("[data-agent-surface], [data-agent-action]", { state: "visible", timeout: 5000 }).catch(() => null);
    const proofAction = await prepareProofState(page, story);
    await page.waitForTimeout(450);
    const clip = await selectProofClip(page, story, proofAction, seedPlan);
    const pageState = await page.evaluate(() => ({
      url: window.location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      captureZoom: document.body.getAttribute("data-aura-changelog-capture-zoom") || "1",
      captureTextScale: document.body.getAttribute("data-aura-changelog-capture-text-scale") || "1",
      text: document.body.innerText.slice(0, 2000),
      bridgeState: window.__AURA_CAPTURE_BRIDGE__?.getState?.() || null,
    }));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: false, clip });
    const buffer = fs.readFileSync(outputPath);
    const dimensions = readPngDimensions(buffer);
    const output = buildCaptureOutput({
      targetAppId,
      targetPath: resolvedTargetPath,
      bridgeResult,
      pageText: pageState.text,
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
