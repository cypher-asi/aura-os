import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessMediaModelQuality,
  buildPublishableMediaManifest,
  discoverCaptureApiBaseUrlFromFrontend,
  preflightCaptureAuth,
  rawVisionCanBeRepairedByImageGeneration,
  requestCaptureSession,
  resolveCaptureApiBaseUrl,
  runChangelogMediaEvaluation,
} from "./evaluate-changelog-media-pipeline.mjs";

function fakeResponse({ status, headers = {}, body = "" }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || "";
      },
    },
    async text() {
      return body;
    },
  };
}

test("resolveCaptureApiBaseUrl prefers explicit API origins", async () => {
  const resolved = await resolveCaptureApiBaseUrl({
    baseUrl: "https://frontend.example.com",
    apiBaseUrl: "https://api.example.com/some/path",
    fetchImpl: async () => {
      throw new Error("explicit API URL should not need discovery");
    },
  });

  assert.equal(resolved, "https://api.example.com");
});

test("assessMediaModelQuality blocks non-Opus models from producing publishable media", () => {
  const gate = assessMediaModelQuality({
    anthropicModel: "claude-sonnet-4-6",
    browserUseModel: "claude-opus-4.6",
    visionJudgeModel: "claude-haiku-4-5",
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.status, "blocked");
  assert.ok(gate.concerns.some((concern) => concern.includes("planner")));
  assert.ok(gate.concerns.some((concern) => concern.includes("vision")));
});

test("buildPublishableMediaManifest omits failed media instead of creating placeholders", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-manifest-"));
  const pngPath = path.join(tempDir, "branded.png");
  writeStructuredPng(pngPath, 160, 90);

  const manifest = buildPublishableMediaManifest({
    captureResults: [
      {
        candidate: {
          entryId: "ready",
          title: "Ready media",
          publicCaption: "Ready media is safe to publish.",
        },
        status: "accepted",
        provider: "browser-use-cloud",
        captureAccepted: true,
        publishReady: true,
        qualityGate: { ok: true, status: "accepted" },
        visionGate: { ok: true, status: "accepted" },
        branding: {
          status: "created",
          quality: { ok: true, status: "accepted" },
          asset: {
            path: path.join(tempDir, "branded.svg"),
            preview: {
              path: pngPath,
              format: "png",
              dimensions: { width: 160, height: 90 },
              bytes: fs.statSync(pngPath).size,
            },
          },
        },
        brandedVisionGate: { ok: true, status: "accepted" },
        result: { screenshot: { path: path.join(tempDir, "raw.png") } },
      },
      {
        candidate: { entryId: "failed", title: "Failed media" },
        status: "rejected",
        captureAccepted: false,
        publishReady: false,
        branding: { status: "blocked" },
      },
    ],
  });

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].entryId, "ready");
  assert.equal(manifest.recoveryPolicy.publishOnlyListedAssets, true);
  assert.equal(manifest.recoveryPolicy.failedOrMissingMediaBehavior, "omit-media-entirely");
  assert.equal(manifest.recoveryPolicy.placeholderHtmlAllowed, false);
});

test("buildPublishableMediaManifest requires accepted vision, not skipped vision", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-manifest-"));
  const pngPath = path.join(tempDir, "branded.png");
  writeStructuredPng(pngPath, 160, 90);
  const commonEntry = {
    status: "accepted",
    provider: "browser-use-cloud",
    captureAccepted: true,
    publishReady: true,
    qualityGate: { ok: true, status: "accepted" },
    branding: {
      status: "created",
      quality: { ok: true, status: "accepted" },
      asset: {
        path: path.join(tempDir, "branded.svg"),
        preview: {
          path: pngPath,
          format: "png",
          dimensions: { width: 160, height: 90 },
          bytes: fs.statSync(pngPath).size,
        },
      },
    },
  };

  const manifest = buildPublishableMediaManifest({
    captureResults: [
      {
        ...commonEntry,
        candidate: { entryId: "raw-skipped", title: "Raw skipped" },
        visionGate: { ok: true, status: "skipped" },
        brandedVisionGate: { ok: true, status: "accepted" },
      },
      {
        ...commonEntry,
        candidate: { entryId: "branded-skipped", title: "Branded skipped" },
        visionGate: { ok: true, status: "accepted" },
        brandedVisionGate: { ok: true, status: "skipped" },
      },
    ],
  });

  assert.equal(manifest.assets.length, 0);
});

test("rawVisionCanBeRepairedByImageGeneration only softens wrong-screen for shell layout proof", () => {
  const rejectedShellVision = {
    ok: false,
    status: "rejected",
    judgment: {
      rejectionCategory: "wrong-screen",
      visibleProof: [
        "Aura desktop header is visible.",
        "Bottom taskbar and side panels are visible but subtle.",
      ],
    },
  };

  assert.equal(rawVisionCanBeRepairedByImageGeneration(rejectedShellVision, {
    title: "Floating-glass desktop shell",
    proofGoal: "Show bottom taskbar capsules and rounded shell panels.",
  }), true);
  assert.equal(rawVisionCanBeRepairedByImageGeneration(rejectedShellVision, {
    title: "GPT-5.5 available in model picker",
    proofGoal: "Show the model picker dropdown.",
  }), false);
  assert.equal(rawVisionCanBeRepairedByImageGeneration({
    ...rejectedShellVision,
    judgment: {
      rejectionCategory: "wrong-screen",
      visibleProof: ["Unrelated settings page."],
    },
  }, {
    title: "Floating-glass desktop shell",
    proofGoal: "Show bottom taskbar capsules and rounded shell panels.",
  }), false);
  assert.equal(rawVisionCanBeRepairedByImageGeneration({
    ok: false,
    status: "rejected",
    judgment: {
      rejectionCategory: "other",
      reasons: ["The right Aura desktop product proof is visible but slightly blurry and distant."],
      visibleProof: ["Aura desktop chat model picker is visible with GPT-5.5 present."],
    },
  }, {
    title: "GPT-5.5 available in model picker",
    proofGoal: "Show the model picker dropdown.",
  }), true);
  assert.equal(rawVisionCanBeRepairedByImageGeneration({
    ok: false,
    status: "rejected",
    judgment: {
      rejectionCategory: "other",
      reasons: [
        "The screenshot does not clearly prove the requested shell changes.",
        "The gallery is not convincingly populated.",
      ],
      visibleProof: ["Aura desktop shell and image gallery are visible."],
    },
  }, {
    title: "Floating-glass desktop shell",
    proofGoal: "Show bottom taskbar capsules and rounded shell panels.",
  }), false);
});

test("discoverCaptureApiBaseUrlFromFrontend finds the API origin used by the deployed app bundle", async () => {
  const requests = [];
  const resolved = await discoverCaptureApiBaseUrlFromFrontend({
    baseUrl: "https://frontend.example.com",
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url) === "https://frontend.example.com") {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "text/html" },
          body: '<script type="module" src="/assets/host-config.js"></script>',
        });
      }
      if (String(url) === "https://frontend.example.com/assets/host-config.js") {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "application/javascript" },
          body: 'const api = "https://api.example.com";',
        });
      }
      if (String(url) === "https://api.example.com/api/auth/session") {
        return fakeResponse({
          status: 401,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "missing authorization token" }),
        });
      }
      return fakeResponse({ status: 404, body: "not found" });
    },
  });

  assert.equal(resolved, "https://api.example.com");
  assert.deepEqual(requests, [
    "https://frontend.example.com",
    "https://frontend.example.com/assets/host-config.js",
    "https://api.example.com/api/auth/session",
  ]);
});

function writeStructuredPng(filePath, width = 160, height = 90) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((width * y) + x) * 4;
      const bright = (x + y) % 24 < 12;
      png.data[offset] = bright ? 235 : 18;
      png.data[offset + 1] = bright ? 240 : 24;
      png.data[offset + 2] = bright ? 245 : 38;
      png.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

async function fakeProductionImageImpl({ inputImagePath, outputPath, model = "gpt-image-2", quality = "high", size = "2560x1440" }) {
  fs.copyFileSync(inputImagePath, outputPath);
  const dimensions = { width: 1920, height: 1080 };
  const bytes = fs.statSync(outputPath).size;
  return {
    status: "created",
    reason: "Fake production image created for tests.",
    asset: {
      path: outputPath,
      format: "png",
      dimensions,
      bytes,
      layout: {
        aspectRatio: 16 / 9,
        labelLines: 0,
        titleLines: 0,
        subtitleLines: 0,
        maxTitleLines: 0,
        maxSubtitleLines: 0,
        screenshot: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
      },
      embeddedScreenshot: {
        path: inputImagePath,
        width: dimensions.width,
        height: dimensions.height,
        bytes,
        renderedWidth: dimensions.width,
        renderedHeight: dimensions.height,
        scale: 1,
        treatment: "openai-production-redraw",
      },
      preview: {
        path: outputPath,
        format: "png",
        dimensions,
        bytes,
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

test("preflightCaptureAuth requires a live capture entry route", async () => {
  const report = await preflightCaptureAuth({
    baseUrl: "https://example.com",
    apiBaseUrl: "https://api.example.com",
    captureSecret: "capture-secret-with-enough-entropy",
    fetchImpl: async (url) => {
      if (String(url).includes("capture-login=1")) {
        return fakeResponse({ status: 404, body: "Not Found" });
      }
      return fakeResponse({ status: 200, body: "" });
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("Capture login route returned HTTP 404")));
  assert.equal(report.sessionAvailable, true);
});

test("requestCaptureSession locally mints media sessions when the API endpoint is unavailable", async () => {
  const report = await requestCaptureSession({
    baseUrl: "https://example.com",
    apiBaseUrl: "https://api.example.com",
    captureSecret: "capture-secret-with-enough-entropy",
    fetchImpl: async () => fakeResponse({ status: 404, headers: { "content-type": "text/html" }, body: "<html></html>" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.source, "local-media-session");
  assert.match(report.session?.access_token || "", /^aura-capture:/);
  assert.equal(report.concerns.length, 0);
  assert.ok(report.fallbackConcerns.some((concern) => concern.includes("expected 201")));
});

test("preflightCaptureAuth accepts the deployed capture contract shape", async () => {
  const report = await preflightCaptureAuth({
    baseUrl: "https://example.com",
    apiBaseUrl: "https://api.example.com",
    captureSecret: "capture-secret-with-enough-entropy",
    fetchImpl: async (url) => {
      if (String(url).includes("capture-login=1")) {
        return fakeResponse({ status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" });
      }
      return fakeResponse({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "aura-capture:test" }),
      });
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.concerns, []);
});

test("runChangelogMediaEvaluation plans media and blocks capture when Browser Use credentials are absent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
    });

    assert.equal(report.counts.plannedCandidates, 1);
    assert.equal(report.counts.captureBlocked, 1);
    assert.equal(report.counts.publishableMediaAssets, 0);
    assert.deepEqual(report.publishableMedia.assets, []);
    assert.equal(report.publishableMedia.recoveryPolicy.placeholderHtmlAllowed, false);
    assert.match(report.captureResults[0].blockers[0], /BROWSER_USE_API_KEY/);
    assert.equal(fs.existsSync(path.join(tempDir, "out", "evaluation-report.json")), true);
    assert.equal(fs.existsSync(path.join(tempDir, "out", "publishable-media-manifest.json")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation creates branded media only after quality and vision pass", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 1920, 1080);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";
  let capturedBrowserUseArgs = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: {
          user_id: "capture-demo-user",
          display_name: "Aura Capture",
          profile_image: "",
          primary_zid: "0://aura-capture",
          zero_wallet: "0x0000000000000000000000000000000000000000",
          wallets: [],
          is_zero_pro: true,
          is_access_granted: true,
          access_token: "aura-capture:test-token",
          created_at: "2026-04-24T00:00:00Z",
          validated_at: "2026-04-24T00:00:00Z",
        },
      }),
      browserUseTimeoutMs: 123456,
      browserUseIntervalMs: 3456,
      runBrowserUseTaskImpl: async (args) => {
        capturedBrowserUseArgs = args;
        return {
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "Aura desktop chat screen with the model picker open.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
        messages: [],
      };
      },
      runHighResolutionCaptureImpl: async () => ({
        ok: true,
        status: "captured",
        provider: "aura-high-res-browser-camera",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "High-resolution Aura desktop capture with model picker proof.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
      }),
      visionJudgeImpl: async () => ({
        ok: true,
        status: "accepted",
        concerns: [],
        judgment: {
          pass: true,
          score: 0.9,
          reasons: ["The model picker is visible and readable."],
          visibleProof: ["GPT-5.5 is visible."],
          rejectionCategory: null,
        },
      }),
      productionImageImpl: fakeProductionImageImpl,
    });

    assert.equal(report.counts.captureAccepted, 1);
    assert.equal(report.counts.visionAccepted, 1);
    assert.equal(report.counts.brandingCreated, 1);
    assert.equal(report.counts.brandedVisionAccepted, 1);
    assert.equal(report.counts.publishReady, 1);
    assert.equal(report.counts.publishableMediaAssets, 1);
    assert.equal(report.publishableMedia.assets.length, 1);
    assert.equal(report.publishableMedia.assets[0].entryId, "entry-1");
    assert.equal(report.browserUseRunOptions.timeoutMs, 123456);
    assert.equal(report.browserUseRunOptions.intervalMs, 3456);
    assert.equal(capturedBrowserUseArgs.timeoutMs, 123456);
    assert.equal(capturedBrowserUseArgs.intervalMs, 3456);
    const branding = report.captureResults[0].branding;
    assert.equal(branding.status, "created");
    assert.equal(fs.existsSync(branding.asset.path), true);
    assert.equal(fs.existsSync(branding.asset.preview.path), true);
    assert.equal(report.publishableMedia.assets[0].source.brandedPngPath, branding.asset.preview.path);
    assert.equal(branding.asset.preview.format, "png");
    assert.equal(branding.asset.embeddedScreenshot.scale, 1);
    assert.equal(report.captureResults[0].brandedVisionGate.status, "accepted");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation falls back to pixel-preserved proof when OpenAI redraw drifts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(feedback): add threaded review board",
        files: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "Feedback board shows threaded review context",
          summary: "Feedback cards and comments are visible together.",
          items: [
            {
              text: "Added a threaded feedback review board.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 2560, 1440);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "Feedback board shows threaded review context",
                  shouldCapture: true,
                  reason: "The feedback board is visible desktop UI.",
                  targetAppId: "feedback",
                  targetPath: "/feedback",
                  proofGoal: "Show the populated feedback board and selected thread.",
                  publicCaption: "Feedback cards and threaded comments are visible together.",
                  confidence: 0.89,
                  changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: { access_token: "aura-capture:test-token" },
      }),
      runBrowserUseTaskImpl: async () => ({
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "feedback",
          targetPath: "/feedback",
          proofSurface: "Feedback board",
          proofVisible: true,
          visibleProof: ["Feedback cards and selected thread comments are visible."],
          screenshotDescription: "Aura desktop feedback board with a selected thread.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 2560, height: 1440 },
        },
        messages: [],
      }),
      runHighResolutionCaptureImpl: async () => ({
        ok: true,
        status: "captured",
        provider: "aura-high-res-browser-camera",
        output: {
          shouldCapture: true,
          targetAppId: "feedback",
          targetPath: "/feedback",
          proofSurface: "Feedback board",
          proofVisible: true,
          visibleProof: ["Feedback cards and selected thread comments are visible."],
          screenshotDescription: "High-resolution Aura desktop feedback board with a selected thread.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 2560, height: 1440 },
        },
      }),
      visionJudgeImpl: async ({ stage }) => {
        if (stage === "branded") {
          return {
            ok: false,
            status: "rejected",
            concerns: ["Vision judge reported generated text drift."],
            judgment: {
              pass: false,
              score: 0.42,
              reasons: ["The generated redraw changed visible feedback copy."],
              visibleProof: ["Feedback board is present but text drifted."],
              rejectionCategory: "other",
              textIntegrity: "materially-changed",
              hallucinatedText: ["Generated redraw changed visible feedback copy."],
            },
          };
        }
        return {
          ok: true,
          status: "accepted",
          concerns: [],
          judgment: {
            pass: true,
            score: 0.91,
            reasons: ["The feedback board and selected thread are visible and readable."],
            visibleProof: ["Feedback cards and selected thread comments are visible."],
            rejectionCategory: null,
          },
        };
      },
      productionImageImpl: fakeProductionImageImpl,
    });

    assert.equal(report.counts.captureAccepted, 1);
    assert.equal(report.counts.publishReady, 1);
    assert.equal(report.counts.publishableMediaAssets, 1);
    const branding = report.captureResults[0].branding;
    assert.equal(branding.status, "created");
    assert.equal(branding.fallbackFor.brandedVisionStatus, "rejected");
    assert.equal(branding.asset.embeddedScreenshot.treatment, "pixel-preserved-production-proof");
    assert.equal(report.captureResults[0].brandedVisionGate.status, "accepted");
    assert.equal(report.publishableMedia.assets[0].source.generatedPngPath, null);
    assert.equal(report.publishableMedia.assets[0].source.brandedPngPath, branding.asset.preview.path);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation requires OpenAI before attempting publishable media", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 1920, 1080);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousMediaOpenAI = process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.OPENAI_API_KEY;
  delete process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY;
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: { access_token: "aura-capture:test-token" },
      }),
      runBrowserUseTaskImpl: async () => ({
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "Aura desktop chat screen with the model picker open.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
        messages: [],
      }),
      runHighResolutionCaptureImpl: async () => ({
        ok: true,
        status: "captured",
        provider: "aura-high-res-browser-camera",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "High-resolution Aura desktop capture with model picker proof.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
      }),
      visionJudgeImpl: async () => ({
        ok: true,
        status: "accepted",
        concerns: [],
        judgment: {
          pass: true,
          score: 0.9,
          reasons: ["The model picker is visible and readable."],
          visibleProof: ["GPT-5.5 is visible."],
          rejectionCategory: null,
        },
      }),
      productionImageImpl: async () => {
        throw new Error("productionImageImpl should not run without an OpenAI API key");
      },
    });

    assert.equal(report.counts.captureBlocked, 1);
    assert.equal(report.counts.visionAccepted, 0);
    assert.equal(report.counts.brandingCreated, 0);
    assert.equal(report.counts.brandedVisionAccepted, 0);
    assert.equal(report.counts.publishReady, 0);
    assert.equal(report.counts.publishableMediaAssets, 0);
    assert.equal(report.captureResults[0].branding.status, "blocked");
    assert.ok(report.captureResults[0].blockers.some((blocker) => blocker.includes("OPENAI_API_KEY")));
    assert.deepEqual(report.publishableMedia.assets, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousMediaOpenAI === undefined) delete process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY;
    else process.env.AURA_CHANGELOG_MEDIA_OPENAI_API_KEY = previousMediaOpenAI;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation does not publish when vision judge is disabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 1920, 1080);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      visionJudge: false,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: {
          user_id: "capture-demo-user",
          display_name: "Aura Capture",
          primary_zid: "0://aura-capture",
          zero_wallet: "0x0000000000000000000000000000000000000000",
          wallets: [],
          is_zero_pro: true,
          is_access_granted: true,
          access_token: "aura-capture:test-token",
          created_at: "2026-04-24T00:00:00Z",
          validated_at: "2026-04-24T00:00:00Z",
        },
      }),
      runBrowserUseTaskImpl: async () => ({
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "Aura desktop chat screen with the model picker open.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
        messages: [],
      }),
      runHighResolutionCaptureImpl: async () => ({
        ok: true,
        status: "captured",
        provider: "aura-high-res-browser-camera",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "High-resolution Aura desktop capture with model picker proof.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
      }),
    });

    assert.equal(report.counts.captureAccepted, 0);
    assert.equal(report.counts.brandingCreated, 0);
    assert.equal(report.captureResults[0].visionGate.status, "skipped");
    assert.equal(report.captureResults[0].brandedVisionGate.status, "blocked");
    assert.equal(report.captureResults[0].publishReady, false);
    assert.equal(report.counts.publishReady, 0);
    assert.equal(report.counts.publishableMediaAssets, 0);
    assert.deepEqual(report.publishableMedia.assets, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});
