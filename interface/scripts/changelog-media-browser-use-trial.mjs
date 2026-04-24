#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAuraNavigationContract } from "./lib/aura-navigation-contract.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

export const DEFAULT_BROWSER_USE_MODEL = "claude-opus-4.6";
const DEFAULT_DESKTOP_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
const DEFAULT_MIN_DESKTOP_VIEWPORT = Object.freeze({ width: 1366, height: 600 });

const BROWSER_USE_CAPTURE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "shouldCapture",
    "targetAppId",
    "targetPath",
    "proofSurface",
    "proofVisible",
    "visibleProof",
    "screenshotDescription",
    "desktopLayoutVisible",
    "mobileLayoutVisible",
    "concerns",
  ],
  properties: {
    shouldCapture: { type: "boolean" },
    targetAppId: { type: ["string", "null"] },
    targetPath: { type: ["string", "null"] },
    proofSurface: { type: ["string", "null"] },
    proofVisible: { type: "boolean" },
    visibleProof: { type: "array", items: { type: "string" } },
    screenshotDescription: { type: "string" },
    desktopLayoutVisible: { type: "boolean" },
    mobileLayoutVisible: { type: "boolean" },
    concerns: { type: "array", items: { type: "string" } },
  },
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;
    if (key in args) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }
  return args;
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

function readChangedFiles(args) {
  const inline = normalizeArray(args["changed-file"]);
  const filePath = args["changed-files-file"] ? path.resolve(String(args["changed-files-file"])) : null;
  if (!filePath) {
    return inline;
  }
  const body = fs.readFileSync(filePath, "utf8").trim();
  if (!body) {
    return inline;
  }
  const parsed = body.startsWith("[") ? JSON.parse(body) : body.split(/\r?\n/g);
  return [...new Set([...inline, ...parsed.map((entry) => String(entry || "").trim()).filter(Boolean)])];
}

function readCommitLog(args) {
  const rawInline = args["commit-log"];
  const inline = (Array.isArray(rawInline) ? rawInline : rawInline ? [rawInline] : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join("\n");
  const filePath = args["commit-log-file"] ? path.resolve(String(args["commit-log-file"])) : null;
  const fileBody = filePath ? fs.readFileSync(filePath, "utf8").trim() : "";
  return [inline, fileBody].filter(Boolean).join("\n\n").trim();
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isDisabled(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

export function buildCaptureLoginUrl(baseUrl, returnTo = "/desktop", apiBaseUrl = "") {
  const url = new URL("/", baseUrl);
  url.searchParams.set("capture-login", "1");
  url.searchParams.set("returnTo", returnTo.startsWith("/") ? returnTo : "/desktop");
  if (apiBaseUrl) {
    url.searchParams.set("host", new URL(apiBaseUrl).origin);
  }
  return url.toString();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    return null;
  }
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function parseBrowserUseOutput(output) {
  if (output && typeof output === "object") {
    return output;
  }
  const body = String(output || "").trim();
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    const match = body.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function extractStructuredOutputFromMessages(messages) {
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    let data = message?.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        continue;
      }
    }
    const toolCalls = Array.isArray(data?.tool_calls) ? data.tool_calls : [];
    for (const toolCall of toolCalls) {
      const rawArgs = toolCall?.function?.arguments;
      if (!rawArgs) continue;
      let args = rawArgs;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          continue;
        }
      }
      const code = String(args?.code || "");
      const match = code.match(/save_output_json\((\{[\s\S]*?\})\s*\)/);
      if (!match) continue;
      const jsonish = match[1]
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/\bNone\b/g, "null");
      try {
        return JSON.parse(jsonish);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function collectMessageText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .flatMap((message) => [
      message?.summary,
      typeof message?.data === "string" ? message.data.slice(0, 1500) : "",
    ])
    .filter(Boolean)
    .join("\n");
}

export function inferNoCaptureFromMessages(messages) {
  const text = collectMessageText(messages);
  if (/\b(?:current url:\s*\S*\/login|\/login\b|auth required|sign in required|login with zero pro)\b/i.test(text)) {
    return {
      shouldCapture: false,
      targetAppId: null,
      targetPath: null,
      proofSurface: null,
      proofVisible: false,
      visibleProof: [],
      screenshotDescription: "No product screenshot captured because the app required authentication.",
      desktopLayoutVisible: true,
      mobileLayoutVisible: false,
      concerns: [
        "Authentication is required before the target desktop product screen can be captured.",
      ],
    };
  }
  return null;
}

export function evaluateDesktopCapture({
  output,
  screenshot,
  mediaEligibility = null,
  minDesktopViewport = DEFAULT_MIN_DESKTOP_VIEWPORT,
} = {}) {
  const parsedOutput = parseBrowserUseOutput(output);
  const concerns = [];
  const expectedNoCapture = mediaEligibility?.shouldAttemptCapture === false;
  const agentWantsCapture = parsedOutput?.shouldCapture === true;
  const screenshotDimensions = screenshot?.dimensions || null;
  const hasScreenshot = Boolean(screenshot?.path);
  const dimensionOk = Boolean(
    screenshotDimensions
      && screenshotDimensions.width >= minDesktopViewport.width
      && screenshotDimensions.height >= minDesktopViewport.height,
  );

  if (!parsedOutput) {
    concerns.push("Browser Use did not return structured capture JSON.");
  }
  if (agentWantsCapture && !hasScreenshot) {
    concerns.push("No browser screenshot was downloaded.");
  }
  if (agentWantsCapture && hasScreenshot && !dimensionOk) {
    concerns.push(
      `Screenshot is below desktop minimum (${screenshotDimensions?.width || 0}x${screenshotDimensions?.height || 0}; minimum ${minDesktopViewport.width}x${minDesktopViewport.height}).`,
    );
  }
  if (agentWantsCapture && parsedOutput?.desktopLayoutVisible === false) {
    concerns.push("The agent reported that desktop layout was not visible.");
  }
  if (agentWantsCapture && parsedOutput?.mobileLayoutVisible === true) {
    concerns.push("The agent reported a mobile layout.");
  }
  if (parsedOutput?.shouldCapture === false && !expectedNoCapture) {
    concerns.push("The agent declined capture for this story.");
  }
  if (agentWantsCapture && parsedOutput?.proofVisible === false) {
    concerns.push("The agent did not verify visible proof.");
  }

  const agentConcerns = Array.isArray(parsedOutput?.concerns)
    ? parsedOutput.concerns.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const mobileConcern = !expectedNoCapture
    && agentConcerns.some((entry) => /\b(mobile|ios|android|narrow|hamburger|bottom nav)\b/i.test(entry));
  if (mobileConcern) {
    concerns.push("The agent concern list mentions a mobile or narrow layout.");
  }

  const ok = Boolean(
    parsedOutput?.shouldCapture === true
      && parsedOutput?.proofVisible === true
      && parsedOutput?.desktopLayoutVisible !== false
      && parsedOutput?.mobileLayoutVisible !== true
      && hasScreenshot
      && dimensionOk
      && !mobileConcern,
  );
  const noCaptureOk = Boolean(
    expectedNoCapture
      && parsedOutput?.shouldCapture === false
      && !mobileConcern,
  );

  return {
    ok,
    noCaptureOk,
    decisionAccepted: ok || noCaptureOk,
    parsedOutput,
    screenshotDimensions,
    minDesktopViewport,
    concerns: [...new Set(concerns)],
  };
}

export function buildBrowserUseTask({
  baseUrl,
  story,
  contract,
  desktopViewport = DEFAULT_DESKTOP_VIEWPORT,
  minDesktopViewport = DEFAULT_MIN_DESKTOP_VIEWPORT,
  captureAuth = null,
}) {
  const captureAuthLines = captureAuth?.enabled
    ? [
      "Capture authentication:",
      `- First open ${captureAuth.loginUrl}.`,
      "- Type the Browser Use sensitive secret placeholder `<secret>captureSecret</secret>` into the field labelled `Capture access key`.",
      "- Submit the form and wait until the Aura desktop shell is visible before looking for the target feature.",
      "- Never print, summarize, or reveal the capture secret.",
      "",
    ]
    : [];

  return [
    "You are creating a production-quality Aura changelog proof screenshot.",
    "",
    "Goal:",
    story,
    "",
    "Aura app base URL:",
    baseUrl,
    "",
    ...captureAuthLines,
    "Navigation contract:",
    JSON.stringify(contract, null, 2),
    "",
    "Desktop-only capture policy:",
    `- Target desktop screenshot expectation: ${desktopViewport.width}x${desktopViewport.height}.`,
    `- Minimum acceptable screenshot size: ${minDesktopViewport.width}x${minDesktopViewport.height}.`,
    "- Capture only the desktop web product UI. Ignore native mobile, iOS, Android, and narrow responsive layouts.",
    "- If the app is rendered as mobile UI, hamburger-only navigation, bottom mobile navigation, or a single narrow mobile column, return shouldCapture=false.",
    "",
    "Rules:",
    "- If navigationContract.mediaEligibility.shouldAttemptCapture is false, do not navigate. Return shouldCapture=false with that reason.",
    "- Prefer the likelyApps list, changed files, route hints, data-agent-* attributes, aria labels, and visible app labels.",
    "- Find the most relevant product screen for the story. Do not stop on auth, loading, empty, placeholder, generic home, or unrelated settings screens.",
    "- If the story is not meaningfully provable in one static desktop screenshot, do not force it.",
    "- If you capture proof, leave the target UI visible, stable, and centered in the real desktop product UI.",
    "- For small proof surfaces such as menus, model pickers, buttons, or status chips, open the relevant popover/dialog and keep it visible. Do not enlarge it artificially.",
    "- Do not change browser zoom, crop, stylize, or re-render the screenshot. The captured pixels must be real Aura product UI.",
    "- Prefer crisp native Browser Use screenshots over any generated or transformed image. Text readability must come from preserving the original PNG quality, not from zooming.",
    "- If the proof is blurry, compressed, clipped, or mostly empty, return shouldCapture=false instead of sending a weak image.",
    "",
    "Final response:",
    "Return JSON only with: shouldCapture, targetAppId, targetPath, proofSurface, proofVisible, visibleProof, screenshotDescription, desktopLayoutVisible, mobileLayoutVisible, concerns.",
  ].join("\n");
}

async function downloadLastScreenshot(messages, outputDir, sessionScreenshotUrl = null) {
  const screenshotUrl = [
    sessionScreenshotUrl,
    ...[...messages]
      .reverse()
      .map((message) => message.screenshot_url || message.screenshotUrl),
  ].find(Boolean);
  if (!screenshotUrl) {
    return null;
  }
  const response = await fetch(screenshotUrl);
  if (!response.ok) {
    return {
      url: screenshotUrl,
      error: `download failed with ${response.status}`,
    };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(outputDir, "last-browser-use-step.png");
  fs.writeFileSync(outputPath, buffer);
  return {
    url: screenshotUrl,
    path: outputPath,
    bytes: buffer.length,
    dimensions: readPngDimensions(buffer),
  };
}

export async function runBrowserUseTask({
  task,
  model,
  outputDir,
  profileId,
  enableRecording,
  desktopViewport,
  maxCostUsd,
  useOutputSchema,
  sensitiveData,
}) {
  const apiKey = process.env.BROWSER_USE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("BROWSER_USE_API_KEY is required unless --dry-run is passed.");
  }

  const { BrowserUse } = await import("browser-use-sdk/v3");
  const client = new BrowserUse({ apiKey });
  const messages = [];
  const run = client.run(task, {
    model,
    enableScheduledTasks: false,
    skills: false,
    agentmail: false,
    ...(useOutputSchema ? { outputSchema: BROWSER_USE_CAPTURE_OUTPUT_SCHEMA } : {}),
    ...(profileId ? { profileId } : {}),
    ...(enableRecording ? { enableRecording: true } : {}),
    ...(maxCostUsd ? { maxCostUsd } : {}),
    ...(sensitiveData && Object.keys(sensitiveData).length > 0 ? { sensitiveData } : {}),
  });

  for await (const message of run) {
    messages.push({
      id: message.id || null,
      role: message.role || null,
      type: message.type || null,
      summary: message.summary || "",
      screenshot_url: message.screenshot_url || message.screenshotUrl || null,
      data: message.data || null,
    });
  }

  const result = run.result;
  const screenshot = await downloadLastScreenshot(
    messages,
    outputDir,
    result?.screenshotUrl || result?.screenshot_url || null,
  );
  const parsedResultOutput = parseBrowserUseOutput(result?.output);
  const recoveredOutput = parsedResultOutput
    ? result?.output
    : extractStructuredOutputFromMessages(messages) || inferNoCaptureFromMessages(messages);
  let recordings = [];
  if (enableRecording && result?.id && client.sessions?.waitForRecording) {
    recordings = await client.sessions.waitForRecording(result.id).catch((error) => [{
      error: error instanceof Error ? error.message : String(error),
    }]);
  }
  return {
    ok: true,
    provider: "browser-use-cloud",
    model,
    profileId: profileId || null,
    requestedDesktopViewport: desktopViewport,
    screenshotSource: screenshot?.url === (result?.screenshotUrl || result?.screenshot_url || null)
      ? "session-screenshot-url"
      : "message-screenshot-url",
    sessionId: run.sessionId || result?.sessionId || result?.session_id || null,
    output: recoveredOutput ?? result?.output ?? null,
    rawOutput: result?.output ?? null,
    messages,
    screenshot,
    recordings,
  };
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseArgs(argv);
  const prompt = String(args.prompt || "").trim();
  if (!prompt) {
    throw new Error("Pass --prompt with the changelog or feature story to test.");
  }

  const baseUrl = String(args["base-url"] || process.env.AURA_DEMO_SCREENSHOT_BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("Pass --base-url or set AURA_DEMO_SCREENSHOT_BASE_URL.");
  }
  const apiBaseUrl = String(
    args["api-base-url"]
      || process.env.AURA_DEMO_SCREENSHOT_API_URL
      || process.env.AURA_CAPTURE_API_BASE_URL
      || "",
  ).trim();

  const outputDir = path.resolve(args["output-dir"] || path.join(process.cwd(), "output", "browser-use-changelog-media-trial"));
  const model = String(args.model || process.env.BROWSER_USE_MODEL || DEFAULT_BROWSER_USE_MODEL).trim();
  const profileId = String(args["profile-id"] || process.env.BROWSER_USE_PROFILE_ID || "").trim();
  const captureSecret = String(
    args["capture-secret"]
      || process.env.AURA_CHANGELOG_CAPTURE_SECRET
      || process.env.AURA_CAPTURE_MODE_SECRET
      || "",
  ).trim();
  const enableRecording = isEnabled(args["enable-recording"] || process.env.BROWSER_USE_ENABLE_RECORDING);
  const strictCapture = isEnabled(args.strict || process.env.BROWSER_USE_STRICT_CAPTURE);
  const useOutputSchema = !isDisabled(args["use-output-schema"] ?? process.env.BROWSER_USE_OUTPUT_SCHEMA ?? "true");
  const maxCostUsd = args["max-cost-usd"] || process.env.BROWSER_USE_MAX_COST_USD || "";
  const desktopViewport = {
    width: parsePositiveInteger(args["desktop-width"] || process.env.BROWSER_USE_DESKTOP_WIDTH, DEFAULT_DESKTOP_VIEWPORT.width),
    height: parsePositiveInteger(args["desktop-height"] || process.env.BROWSER_USE_DESKTOP_HEIGHT, DEFAULT_DESKTOP_VIEWPORT.height),
  };
  const minDesktopViewport = {
    width: parsePositiveInteger(args["min-desktop-width"] || process.env.BROWSER_USE_MIN_DESKTOP_WIDTH, DEFAULT_MIN_DESKTOP_VIEWPORT.width),
    height: parsePositiveInteger(args["min-desktop-height"] || process.env.BROWSER_USE_MIN_DESKTOP_HEIGHT, DEFAULT_MIN_DESKTOP_VIEWPORT.height),
  };
  const changedFiles = readChangedFiles(args);
  const commitLog = readCommitLog(args);
  const contract = await buildAuraNavigationContract({ prompt, changedFiles, commitLog });
  const captureAuth = captureSecret
    ? {
      enabled: true,
      loginUrl: buildCaptureLoginUrl(baseUrl, contract.likelyApps?.[0]?.path || "/desktop", apiBaseUrl),
    }
    : { enabled: false, loginUrl: null };
  const task = buildBrowserUseTask({
    baseUrl,
    story: prompt,
    contract,
    desktopViewport,
    minDesktopViewport,
    captureAuth,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "navigation-contract.json"), contract);
  fs.writeFileSync(path.join(outputDir, "browser-use-task.md"), `${task}\n`, "utf8");

  if (isEnabled(args["dry-run"])) {
    const summary = {
      ok: true,
      dryRun: true,
      provider: "browser-use-cloud",
      model,
      profileId: profileId || null,
      enableRecording,
      captureAuthEnabled: captureAuth.enabled,
      strictCapture,
      useOutputSchema,
      baseUrl,
      prompt,
      changedFiles,
      commitLogProvided: commitLog.length > 0,
      commitLogExcerpt: contract.commitContext?.logExcerpt || "",
      desktopViewport,
      minDesktopViewport,
      outputDir,
    };
    writeJson(path.join(outputDir, "browser-use-trial-summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  if (contract.mediaEligibility?.shouldAttemptCapture === false) {
    const output = {
      shouldCapture: false,
      targetAppId: null,
      targetPath: null,
      proofSurface: null,
      proofVisible: false,
      visibleProof: [],
      screenshotDescription: "No screenshot captured because the changelog candidate is not desktop media eligible.",
      desktopLayoutVisible: false,
      mobileLayoutVisible: false,
      concerns: [
        contract.mediaEligibility.reason || "changelog media capture is desktop-only",
      ],
    };
    const desktopEvaluation = evaluateDesktopCapture({
      output,
      screenshot: null,
      mediaEligibility: contract.mediaEligibility,
      minDesktopViewport,
    });
    const summary = {
      ok: true,
      skippedBeforeBrowserUse: true,
      provider: "browser-use-cloud",
      model,
      profileId: profileId || null,
      captureAuthEnabled: captureAuth.enabled,
      output,
      rawOutput: null,
      messages: [],
      screenshot: null,
      recordings: [],
      baseUrl,
      prompt,
      changedFiles,
      commitLogProvided: commitLog.length > 0,
      commitLogExcerpt: contract.commitContext?.logExcerpt || "",
      desktopViewport,
      minDesktopViewport,
      desktopEvaluation,
      outputDir,
    };
    writeJson(path.join(outputDir, "browser-use-trial-summary.json"), summary);
    writeJson(path.join(outputDir, "browser-use-messages.json"), []);
    console.log(JSON.stringify({
      ok: true,
      skippedBeforeBrowserUse: true,
      captureAccepted: false,
      decisionAccepted: desktopEvaluation.decisionAccepted,
      reason: contract.mediaEligibility.reason,
      outputDir,
      desktopEvaluation,
      output,
    }, null, 2));
    return summary;
  }

  const result = await runBrowserUseTask({
    task,
    model,
    outputDir,
    profileId,
    enableRecording,
    desktopViewport,
    maxCostUsd,
    useOutputSchema,
    sensitiveData: captureAuth.enabled ? { captureSecret } : null,
  });
  const desktopEvaluation = evaluateDesktopCapture({
    output: result.output,
    screenshot: result.screenshot,
    mediaEligibility: contract.mediaEligibility,
    minDesktopViewport,
  });
  const summary = {
    ...result,
    baseUrl,
    prompt,
    changedFiles,
    commitLogProvided: commitLog.length > 0,
    commitLogExcerpt: contract.commitContext?.logExcerpt || "",
    desktopViewport,
    minDesktopViewport,
    desktopEvaluation,
    outputDir,
    captureAuthEnabled: captureAuth.enabled,
  };
  writeJson(path.join(outputDir, "browser-use-trial-summary.json"), summary);
  writeJson(path.join(outputDir, "browser-use-messages.json"), result.messages);
  console.log(JSON.stringify({
    ok: true,
    captureAccepted: desktopEvaluation.ok,
    provider: summary.provider,
    model: summary.model,
    profileId: summary.profileId,
    sessionId: summary.sessionId,
    outputDir,
    screenshot: summary.screenshot,
    desktopEvaluation,
    recordings: summary.recordings,
    output: summary.output,
  }, null, 2));
  if (strictCapture && !desktopEvaluation.ok) {
    if (desktopEvaluation.noCaptureOk) {
      return summary;
    }
    process.exitCode = 2;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
