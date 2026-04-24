import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BROWSER_USE_MODEL,
  buildBrowserUseTask,
  evaluateDesktopCapture,
  extractStructuredOutputFromMessages,
  inferNoCaptureFromMessages,
  parseBrowserUseOutput,
  readPngDimensions,
} from "./changelog-media-browser-use-trial.mjs";

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(buffer, 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("readPngDimensions extracts dimensions from a PNG header", () => {
  assert.deepEqual(readPngDimensions(pngHeader(1920, 1080)), {
    width: 1920,
    height: 1080,
  });
});

test("evaluateDesktopCapture accepts desktop proof and rejects mobile-sized proof", () => {
  const output = {
    shouldCapture: true,
    proofVisible: true,
    desktopLayoutVisible: true,
    mobileLayoutVisible: false,
    concerns: [],
  };

  assert.equal(evaluateDesktopCapture({
    output,
    screenshot: {
      path: "/tmp/desktop.png",
      dimensions: { width: 1920, height: 1080 },
    },
  }).ok, true);

  const mobileReport = evaluateDesktopCapture({
    output: {
      ...output,
      desktopLayoutVisible: false,
      mobileLayoutVisible: true,
      concerns: ["narrow mobile layout"],
    },
    screenshot: {
      path: "/tmp/mobile.png",
      dimensions: { width: 390, height: 844 },
    },
  });

  assert.equal(mobileReport.ok, false);
  assert.ok(mobileReport.concerns.some((entry) => entry.includes("below desktop minimum")));
  assert.ok(mobileReport.concerns.some((entry) => entry.includes("reported a mobile layout")));
});

test("evaluateDesktopCapture treats expected no-capture as an accepted decision", () => {
  const report = evaluateDesktopCapture({
    output: {
      shouldCapture: false,
      proofVisible: false,
      desktopLayoutVisible: false,
      mobileLayoutVisible: false,
      concerns: ["changed files are mobile-only"],
    },
    mediaEligibility: { shouldAttemptCapture: false },
    screenshot: null,
  });

  assert.equal(report.ok, false);
  assert.equal(report.noCaptureOk, true);
  assert.equal(report.decisionAccepted, true);
  assert.ok(!report.concerns.some((entry) => entry.includes("No browser screenshot")));
});

test("parseBrowserUseOutput tolerates JSON wrapped in text", () => {
  const parsed = parseBrowserUseOutput('Result:\n{"shouldCapture":false,"concerns":["auth"]}');
  assert.equal(parsed.shouldCapture, false);
  assert.deepEqual(parsed.concerns, ["auth"]);
});

test("extractStructuredOutputFromMessages recovers Browser Use save_output_json output", () => {
  const parsed = extractStructuredOutputFromMessages([
    {
      data: JSON.stringify({
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({
                code: 'save_output_json({"shouldCapture": False, "concerns": ["mobile-only"], "proofVisible": False})',
              }),
            },
          },
        ],
      }),
    },
  ]);

  assert.equal(parsed.shouldCapture, false);
  assert.equal(parsed.proofVisible, false);
  assert.deepEqual(parsed.concerns, ["mobile-only"]);
});

test("inferNoCaptureFromMessages converts auth-blocked runs into structured output", () => {
  const parsed = inferNoCaptureFromMessages([
    {
      summary: "Browser Navigate: Navigated\nCurrent URL: https://aura-app-72ms.onrender.com/login",
      data: "",
    },
  ]);

  assert.equal(parsed.shouldCapture, false);
  assert.equal(parsed.proofVisible, false);
  assert.match(parsed.concerns[0], /Authentication is required/);
});

test("buildBrowserUseTask includes the desktop-only contract", () => {
  const task = buildBrowserUseTask({
    baseUrl: "https://example.com",
    story: "Show GPT-5.5 in the model picker.",
    contract: {
      mediaEligibility: { shouldAttemptCapture: true },
      likelyApps: [{ id: "agents", path: "/agents" }],
    },
  });

  assert.equal(DEFAULT_BROWSER_USE_MODEL, "claude-opus-4.6");
  assert.match(task, /Target desktop screenshot expectation: 1920x1080/);
  assert.match(task, /Capture only the desktop web product UI/);
  assert.match(task, /Do not change browser zoom/);
  assert.doesNotMatch(task, /zoom up to/i);
  assert.match(task, /Return JSON only/);
});

test("buildBrowserUseTask uses Browser Use sensitive data placeholders for capture auth", () => {
  const task = buildBrowserUseTask({
    baseUrl: "https://example.com",
    story: "Show GPT-5.5 in the model picker.",
    contract: {
      mediaEligibility: { shouldAttemptCapture: true },
      likelyApps: [{ id: "agents", path: "/agents" }],
    },
    captureAuth: {
      enabled: true,
      loginUrl: "https://example.com/capture-login?returnTo=%2Fagents",
    },
  });

  assert.match(task, /Capture authentication:/);
  assert.match(task, /<secret>captureSecret<\/secret>/);
  assert.doesNotMatch(task, /capture-secret-with-enough-entropy/);
});
