import { chromium } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { installBootAuth, installSeedRoutes } from "./demo-browser-seed.mjs";

function parsePattern(pattern) {
  if (!pattern) return /.*/;
  const matched = pattern.match(/^\/(.+)\/([a-z]*)$/i);
  if (matched) {
    return new RegExp(matched[1], matched[2]);
  }
  return new RegExp(pattern);
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

function applyOccurrence(locator, selector) {
  return selector.occurrence === "first" ? locator.first() : locator;
}

function resolveLocator(page, selector, root = page) {
  const scope = selector.within ? resolveLocator(page, selector.within, root) : root;
  let locator;
  if (selector.type === "css") {
    locator = scope.locator(selector.value || "");
  } else if (selector.type === "placeholder") {
    locator = scope.getByPlaceholder(selector.value || "");
  } else if (selector.type === "text") {
    locator = scope.getByText(selector.value || "", selector.exact ? { exact: true } : undefined);
  } else if (selector.type === "title") {
    locator = scope.getByTitle(selector.value || "");
  } else if (selector.type === "role") {
    locator = scope.getByRole(selector.role, {
      ...(selector.name ? { name: selector.name } : {}),
      ...(typeof selector.pressed === "boolean" ? { pressed: selector.pressed } : {}),
    });
  } else {
    throw new Error(`Unsupported selector type ${selector.type}`);
  }
  if (selector.hasText) {
    locator = locator.filter({ hasText: selector.hasText });
  }
  return applyOccurrence(locator, selector);
}

async function screenshotRegion(page, screenshot, outputPath) {
  const selectors = screenshot.targets ?? (screenshot.target ? [screenshot.target] : []);
  if (selectors.length === 0) {
    await page.screenshot({ path: outputPath, fullPage: true });
    return;
  }

  const boxes = [];
  for (const selector of selectors) {
    const locator = resolveLocator(page, selector);
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`Could not resolve screenshot target bounding box for ${JSON.stringify(selector)}`);
    }
    boxes.push(box);
  }

  const clip = {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.min(...boxes.map((box) => box.y)),
    width: Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x)),
    height: Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y)),
  };
  const padding = expandPadding(screenshot.padding);
  const viewport = page.viewportSize() ?? { width: 1600, height: 1000 };
  const paddedClip = {
    x: Math.max(0, clip.x - padding.left),
    y: Math.max(0, clip.y - padding.top),
    width: Math.min(viewport.width, clip.x + clip.width + padding.right) - Math.max(0, clip.x - padding.left),
    height: Math.min(viewport.height, clip.y + clip.height + padding.bottom) - Math.max(0, clip.y - padding.top),
  };

  await page.screenshot({
    path: outputPath,
    clip: paddedClip,
  });
}

async function assertSelector(page, selector) {
  if (selector.type === "url") {
    const pattern = parsePattern(selector.pattern);
    await page.waitForURL(pattern, { timeout: 15_000 });
    return;
  }
  try {
    await resolveLocator(page, selector).waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const debugPath = path.join(process.cwd(), "output", "demo-screenshots", `debug-${Date.now()}.png`);
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nCurrent URL: ${currentUrl}\nBody text: ${bodyText.slice(0, 600)}\nDebug screenshot: ${debugPath}`);
  }
}

async function runStepAction(page, action) {
  if (action.type === "script") {
    await page.evaluate(
      ({ code, args }) => {
        // The seeded screenshot profiles are authored inside the repo, so
        // running a small page-side snippet here is acceptable and keeps
        // interactions deterministic across local and Browserbase runs.
        return globalThis.eval(code)(args);
      },
      {
        code: String(action.code || "() => undefined"),
        args: action.args ?? null,
      },
    );
    await page.waitForTimeout(action.waitMs ?? 250);
    return;
  }

  const locator = resolveLocator(page, action.selector);
  if (action.type === "click") {
    await locator.click({ force: true });
    await page.waitForTimeout(250);
    return;
  }
  if (action.type === "fill") {
    await locator.fill(String(action.value || ""));
    await page.waitForTimeout(120);
    return;
  }
  throw new Error(`Unsupported step action ${action.type}`);
}

async function connectBrowserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for Browserbase capture");
  }
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": apiKey,
    },
    body: JSON.stringify({
      ...(projectId ? { projectId } : {}),
      keepAlive: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Browserbase session create failed (${response.status}): ${await response.text()}`);
  }
  const session = await response.json();
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  return {
    provider: "browserbase",
    browser,
    context,
    sessionId: session.id,
    inspectorUrl: `https://browserbase.com/sessions/${session.id}`,
  };
}

async function connectLocal(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  return {
    provider: "local",
    browser,
    context,
    sessionId: null,
    inspectorUrl: null,
  };
}

export async function captureSeededScreenshots({
  profile,
  baseUrl,
  outputDir,
  provider = "auto",
}) {
  await fs.mkdir(outputDir, { recursive: true });
  const viewport = profile.viewport ?? { width: 1600, height: 1000 };
  const connection = provider === "browserbase" || (provider === "auto" && process.env.BROWSERBASE_API_KEY)
    ? await connectBrowserbase()
    : await connectLocal(viewport);

  const page = await connection.context.newPage();
  if (connection.provider === "browserbase") {
    await page.setViewportSize(viewport);
  }
  const consoleMessages = [];
  page.on("console", (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`);
  });
  page.on("response", async (response) => {
    const request = response.request();
    const type = request.resourceType();
    if (type === "script" || type === "fetch" || type === "xhr") {
      const contentType = response.headers()["content-type"] || "";
      consoleMessages.push(`[response:${type}] ${response.status()} ${request.method()} ${response.url()} :: ${contentType}`);
    }
  });

  await installBootAuth(page, profile.session);
  await installSeedRoutes(page, profile);
  await page.goto(new URL(profile.entryPath, baseUrl).toString(), { waitUntil: "domcontentloaded" });

  const manifest = {
    provider: connection.provider,
    sessionId: connection.sessionId,
    inspectorUrl: connection.inspectorUrl,
    profileId: profile.id,
    title: profile.title,
    mode: profile.mode ?? "seeded-demo",
    authMode: profile.authMode ?? "bootstrapped-demo-session",
    dataMode: profile.dataMode ?? "seeded-api-routes",
    baseUrl,
    outputDir,
    finalUrl: page.url(),
    consoleMessages,
    screenshots: [],
  };

  try {
    for (const step of profile.steps) {
      for (const selector of step.assertions ?? []) {
        await assertSelector(page, selector);
      }
      for (const action of step.actions ?? []) {
        await runStepAction(page, action);
      }
      for (const selector of step.assertionsAfter ?? step.postAssertions ?? []) {
        await assertSelector(page, selector);
      }

      const screenshotPath = path.join(outputDir, step.screenshot.path);
      await screenshotRegion(page, step.screenshot, screenshotPath);
      manifest.screenshots.push({
        id: step.id,
        title: step.title,
        summary: step.summary,
        path: screenshotPath,
        targets: step.screenshot.targets ?? (step.screenshot.target ? [step.screenshot.target] : []),
      });
    }

    await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  } catch (error) {
    const diagnostics = {
      ...manifest,
      error: error instanceof Error ? error.message : String(error),
    };
    await fs.writeFile(path.join(outputDir, "manifest.error.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    await connection.browser.close();
  }
}
